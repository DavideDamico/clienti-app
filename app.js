(function () {
  'use strict';

  /* =====================================================================
     CONFIGURAZIONE — per aggiungere tappe, passaggi o tipi basta
     modificare queste liste: pagine, filtri ed export si aggiornano.
     ===================================================================== */

  // Percorso del cliente, in ordine.
  const FASI = [
    { id: 'contatto',   breve: 'Contatto',   nome: 'Primo contatto' },
    { id: 'trattativa', breve: 'Trattativa', nome: 'In trattativa' },
    { id: 'ordine',     breve: 'Ordine',     nome: 'Ordine confermato' },
    { id: 'acconto',    breve: 'Acconto',    nome: 'Acconto pagato' },
    { id: 'saldo',      breve: 'Saldo',      nome: 'Saldo pagato' }
  ];
  // Esiti che fermano il percorso (la tappa raggiunta resta memorizzata).
  const ESITI = [
    { id: 'pausa',     nome: 'In pausa',  spiega: 'Da riprendere più avanti' },
    { id: 'rifiutato', nome: 'Rifiutato', spiega: 'Il cliente ha detto no' }
  ];

  // Lavoro con il fornitore: passaggi in ordine. «base» è il valore quando nessun passo è spuntato.
  // {F} nei testi diventa il nome del referente scelto nelle Impostazioni (di base «Fornitore»).
  const PASSI_F = {
    registrazione: { base: 'non_inviata', passi: [
      { id: 'inviata',    nome: 'Registrazione inviata a {F}',   data: 'dataRegInviata' },
      { id: 'confermata', nome: 'Registrazione confermata',      data: 'dataRegConfermata' }
    ] },
    fattura: { base: 'da_richiedere', passi: [
      { id: 'dati_inviati', nome: 'Dati per la fattura inviati a {F}', data: 'dataDatiInviati' },
      { id: 'ricevuta',     nome: 'Fattura e link ricevuti da {F}',    data: 'dataFatturaRicevuta' },
      { id: 'inoltrata',    nome: 'Fattura mandata al cliente',        data: 'dataFatturaInoltrata' }
    ] },
    commissione: { base: 'non_maturata', passi: [
      { id: 'maturata', nome: 'Commissione maturata', data: 'dataCommMaturata' },
      { id: 'pagata',   nome: 'Commissione pagata',   data: 'dataCommPagata' }
    ] }
  };
  const NOMI_F = {
    registrazione: { non_inviata: 'Da inviare', inviata: 'Inviata', confermata: 'Confermata' },
    fattura: { da_richiedere: 'Da richiedere', dati_inviati: 'Dati inviati a {F}', ricevuta: 'Fattura ricevuta', inoltrata: 'Mandata al cliente' },
    commissione: { non_maturata: 'Non maturata', maturata: 'Maturata', pagata: 'Pagata' }
  };

  // Giorni di attesa prima che un'attesa diventi un sollecito in «Da fare».
  const SOLLECITI = { registrazione: 3, fattura: 2, pagamento: 7, pausa: 30 };

  // Dati che servono per la fattura (riepilogo «completi 6/6» e automatismo all'ordine).
  const CAMPI_FATTURA = [
    ['ragioneSociale', 'ragione sociale'], ['partitaIva', 'Partita IVA'], ['indirizzoFatturazione', 'sede legale'],
    ['indirizzoConsegna', 'indirizzo di consegna'], ['destinatarioConsegna', 'destinatario'], ['telefonoConsegna', 'telefono per la consegna']
  ];

  const TIPI_APP = [
    { id: 'incontro',   nome: 'Incontro' },
    { id: 'telefonata', nome: 'Telefonata' },
    { id: 'consegna',   nome: 'Consegna' },
    { id: 'altro',      nome: 'Altro' }
  ];

  const CHIAVE = 'flpit_dati_v2';
  const CHIAVE_V1 = 'flpit_clienti_v1';
  const CHIAVE_EXPORT = 'flpit_ultimo_export';
  const CHIAVE_IMP = 'flpit_impostazioni';
  const VERSIONE_DATI = 3;

  const FASE = Object.fromEntries(FASI.map((f, i) => [f.id, { ...f, n: i + 1 }]));
  const ESITO = Object.fromEntries(ESITI.map(e => [e.id, e]));
  const TIPO = Object.fromEntries(TIPI_APP.map(t => [t.id, t]));

  /* ---------------------------------------------------------------------
     IMPOSTAZIONI: salvate solo su questo telefono, mai nel codice.
     --------------------------------------------------------------------- */
  const CAMPI_IMP = ['referente', 'azienda', 'commissione', 'firma'];
  function caricaImp() {
    try { const d = JSON.parse(localStorage.getItem(CHIAVE_IMP) || '{}'); return d && typeof d === 'object' ? d : {}; }
    catch (e) { return {}; }
  }
  let imp = caricaImp();
  function salvaImp() { try { localStorage.setItem(CHIAVE_IMP, JSON.stringify(imp)); } catch (e) {} }
  const refF = () => (imp.referente || '').trim() || 'Fornitore';
  // Nelle frasi: «inviata a Mario», oppure senza nome «inviata al fornitore».
  const PREP_F = { a: 'al', da: 'dal', di: 'del', con: 'con il', per: 'per il' };
  const conRef = s => ((imp.referente || '').trim()
    ? s.replace(/\{F\}/g, imp.referente.trim())
    : s.replace(/\b(a|da|di|con|per) \{F\}/g, (m, p) => `${PREP_F[p]} fornitore`).replace(/\{F\}/g, 'il fornitore'));
  const intestazione = t => t.replace(/\{F\}/g, refF()); // colonne dell'export: «Mario · …» o «Fornitore · …»

  /* ---------------------------------------------------------------------
     COSE DA FARE: una sola definizione usata dalla pagina «Da fare»,
     dalle righe dei clienti e dall'export.
     --------------------------------------------------------------------- */
  const aperto = c => !c.esito;
  // Completato: saldo pagato dal cliente e commissione incassata. Si calcola dallo stato, non si imposta a mano.
  const completato = c => !c.esito && c.fase === 'saldo' && c.fornitore.commissione === 'pagata';
  const attivo = c => aperto(c) && !completato(c);
  const tappa = c => FASE[c.fase].n;
  const giorniDa = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return -1;
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    return Math.round((oggi - new Date(+m[1], +m[2] - 1, +m[3])) / 864e5);
  };
  const scaduto = (iso, giorni) => giorniDa(iso) >= giorni;
  const sollecitoReg = c => aperto(c) && c.fornitore.registrazione === 'inviata' && scaduto(c.fornitore.dataRegInviata, SOLLECITI.registrazione);
  const sollecitoFattura = c => aperto(c) && c.fornitore.fattura === 'dati_inviati' && scaduto(c.fornitore.dataDatiInviati, SOLLECITI.fattura);
  const attesaPagamento = c => aperto(c) && c.fornitore.fattura === 'inoltrata' && c.fase !== 'saldo';
  const sollecitoPagamento = c => attesaPagamento(c) && tappa(c) < 4 && scaduto(c.fornitore.dataFatturaInoltrata, SOLLECITI.pagamento);
  function ultimaAttivita(c) {
    const date = c.appuntamenti.map(a => a.data || '').concat([(c.dataEsito || c.aggiornato || '').slice(0, 10)]);
    return date.filter(Boolean).sort().pop() || '';
  }
  const daRiprendere = c => c.esito === 'pausa' && !c.appuntamenti.some(a => !a.fatto) && scaduto(ultimaAttivita(c), SOLLECITI.pausa);

  const AZIONI_F = [
    // tue azioni
    { id: 'registrazione', titolo: 'Registrazione da inviare a {F}', breve: 'Invia la registrazione a {F}', mia: true, tab: 'fornitore',
      f: c => aperto(c) && c.fornitore.registrazione === 'non_inviata' },
    { id: 'sollecito_reg', titolo: 'Sollecita {F}: conferma della registrazione', breve: 'Sollecita {F}: conferma registrazione', mia: true, tab: 'fornitore',
      f: sollecitoReg },
    { id: 'dati', titolo: 'Dati per la fattura da inviare a {F}', breve: 'Invia i dati per la fattura a {F}', mia: true, tab: 'fornitore',
      f: c => aperto(c) && tappa(c) >= 3 && c.fornitore.fattura === 'da_richiedere' },
    { id: 'sollecito_fattura', titolo: 'Sollecita {F}: fattura', breve: 'Sollecita {F}: fattura', mia: true, tab: 'fornitore',
      f: sollecitoFattura },
    { id: 'fattura_cliente', titolo: 'Fattura da mandare al cliente', breve: 'Manda la fattura al cliente', mia: true, tab: 'fornitore',
      f: c => c.fornitore.fattura === 'ricevuta' },
    { id: 'sollecito_pagamento', titolo: 'Sollecita il pagamento', breve: 'Sollecita il pagamento al cliente', mia: true, tab: 'fornitore',
      f: sollecitoPagamento },
    { id: 'commissione', titolo: 'Commissione da incassare', breve: 'Commissione da incassare', mia: true, tab: 'fornitore',
      f: c => c.fase === 'saldo' && c.fornitore.commissione !== 'pagata' },
    { id: 'riprendi', titolo: 'Riprendi il contatto', breve: 'In pausa da tempo: riprendi il contatto', mia: true, tab: 'appuntamenti',
      f: daRiprendere },
    // attese (quando scatta il sollecito, l'attesa sparisce)
    { id: 'attesa_reg', titolo: 'Conferma della registrazione', breve: 'In attesa della conferma di {F}', tab: 'fornitore',
      f: c => c.fornitore.registrazione === 'inviata' && !sollecitoReg(c) },
    { id: 'attesa_fattura', titolo: 'Fattura da {F}', breve: 'In attesa della fattura di {F}', tab: 'fornitore',
      f: c => c.fornitore.fattura === 'dati_inviati' && !sollecitoFattura(c) },
    { id: 'attesa_pagamento', titolo: 'Pagamento del cliente', breve: 'In attesa del pagamento', tab: 'fornitore',
      f: c => attesaPagamento(c) && !sollecitoPagamento(c) }
  ];

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* =====================================================================
     DATI
     ===================================================================== */
  function nuovoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function normalizza(c) {
    c.id = c.id || nuovoId();
    c.fase = FASE[c.fase] ? c.fase : 'contatto';
    c.esito = ESITO[c.esito] ? c.esito : '';
    // fino alla versione 2 dei dati il lavoro col fornitore aveva un altro nome di campo
    const CAMPO_V2 = 'kr' + 'is';
    const vecchio = c[CAMPO_V2];
    delete c[CAMPO_V2];
    c.fornitore = Object.assign({ registrazione: 'non_inviata', fattura: 'da_richiedere', commissione: 'non_maturata' }, c.fornitore || vecchio || {});
    c.appuntamenti = Array.isArray(c.appuntamenti) ? c.appuntamenti : [];
    c.appuntamenti.forEach(a => { a.id = a.id || nuovoId(); a.tipo = TIPO[a.tipo] ? a.tipo : 'altro'; a.fatto = !!a.fatto; });
    return c;
  }

  // Dati della prima versione (un solo «stato» misto cliente/fornitore).
  function migraV1(vecchi) {
    const mappa = {
      trattativa: { fase: 'trattativa' }, ricontattare: { fase: 'trattativa' }, attesa: { fase: 'trattativa' },
      ['dati_' + 'kr' + 'is']: { fase: 'ordine', fattura: 'dati_inviati' }, // nome dello stato nella prima versione
      fattura: { fase: 'ordine', fattura: 'inoltrata' },
      acconto: { fase: 'acconto', fattura: 'inoltrata' }, completato: { fase: 'saldo', fattura: 'inoltrata' },
      rifiutato: { fase: 'trattativa', esito: 'rifiutato' }
    };
    return vecchi.map(v => {
      const m = mappa[v.stato] || {};
      const c = {
        id: v.id, creato: v.creato, aggiornato: v.aggiornato, fase: m.fase, esito: m.esito || '',
        nomeLocale: v.nomeLocale, citta: v.citta, referente: v.referente, telefono: v.telefono, email: v.email,
        ragioneSociale: v.ragioneSociale, partitaIva: v.partitaIva, indirizzoFatturazione: v.indirizzoFatturazione,
        indirizzoConsegna: v.indirizzoConsegna, destinatarioConsegna: v.destinatarioConsegna, telefonoConsegna: v.telefonoConsegna,
        bundle: v.bundle, logo: v.logo, note: v.note,
        fornitore: { registrazione: v.registrazioneFlpit || 'non_inviata', dataRegInviata: v.dataRegistrazioneInviata,
          dataRegConfermata: v.dataRegistrazioneConfermata, fattura: m.fattura || 'da_richiedere' },
        appuntamenti: v.dataPrimoContatto ? [{ tipo: 'incontro', data: v.dataPrimoContatto, ora: '', fatto: true, note: '' }] : []
      };
      if (v.stato === 'ricontattare') c.note = ((c.note || '') + '\n[Da ricontattare]').trim();
      return normalizza(c);
    });
  }

  function carica() {
    try {
      const v2 = localStorage.getItem(CHIAVE);
      if (v2) { const d = JSON.parse(v2); return (Array.isArray(d.clienti) ? d.clienti : []).map(normalizza); }
      const v1 = JSON.parse(localStorage.getItem(CHIAVE_V1) || '[]');
      if (Array.isArray(v1) && v1.length) {
        const migrati = migraV1(v1);
        localStorage.setItem(CHIAVE, JSON.stringify({ versione: VERSIONE_DATI, clienti: migrati }));
        return migrati;
      }
    } catch (e) { /* dati illeggibili: si parte vuoti senza cancellare nulla */ }
    return [];
  }
  function salvaTutto() {
    try { localStorage.setItem(CHIAVE, JSON.stringify({ versione: VERSIONE_DATI, clienti })); return true; }
    catch (e) { toast('Impossibile salvare sul telefono: fai subito un backup'); return false; }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  let clienti = carica();
  let pagina = 'dafare';
  let filtroClienti = 'attivi';
  let corrente = null;
  let nuovo = false;
  let tab = 'cliente';
  let scrollPagina = 0;
  let timerSalvato = null;

  /* =====================================================================
     UTILITÀ
     ===================================================================== */
  const pad = n => String(n).padStart(2, '0');
  const isoData = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const oggiIso = () => isoData(new Date());
  const traGiorni = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoData(d); };
  const oraAdesso = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function dataIt(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || ''); }
  function giorno(iso, lungo) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    if (iso === oggiIso()) return 'Oggi';
    if (iso === traGiorni(1)) return 'Domani';
    if (iso === traGiorni(-1)) return 'Ieri';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('it-IT',
      lungo ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function dataOraIt(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const leggi = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  function scrivi(o, p, v) { const k = p.split('.'); const u = k.pop(); k.reduce((x, q) => (x[q] = x[q] || {}), o)[u] = v; }
  // Messaggio breve; con «azione» mostra un bottone (es. Annulla) e resta più a lungo.
  let azioneToast = null;
  function toast(msg, azione) {
    const t = $('#toast');
    azioneToast = azione || null;
    t.innerHTML = `<span>${esc(msg)}</span>${azione ? `<button type="button" id="toast-azione">${esc(azione.testo)}</button>` : ''}`;
    t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; azioneToast = null; }, azione ? 6000 : 2400);
  }
  function vuoto(c) {
    return !['nomeLocale', 'citta', 'referente', 'telefono', 'email', 'ragioneSociale', 'partitaIva',
      'indirizzoFatturazione', 'indirizzoConsegna', 'destinatarioConsegna', 'telefonoConsegna', 'note'].some(k => (c[k] || '').trim());
  }
  const tocca = c => { c.aggiornato = new Date().toISOString(); };
  const nome = c => c.nomeLocale || 'Senza nome';
  const nomeStato = c => (c.esito ? ESITO[c.esito].nome : completato(c) ? 'Completato' : FASE[c.fase].nome);
  const ICONA = id => `<svg><use href="#i-${id}"/></svg>`;
  const CHEV = '<svg class="chev"><use href="#i-avanti"/></svg>';

  // appuntamenti
  const chiaveApp = a => `${a.data || '9999-99-99'} ${a.ora || '99:99'}`;
  const appOrdinati = c => [...c.appuntamenti].sort((a, b) => chiaveApp(a).localeCompare(chiaveApp(b)));
  function etichettaApp(c, a) {
    if (a.tipo !== 'incontro') return TIPO[a.tipo].nome;
    return `${appOrdinati(c).filter(x => x.tipo === 'incontro').indexOf(a) + 1}° incontro`;
  }
  const prossimoApp = c => appOrdinati(c).find(a => !a.fatto) || null;
  const inRitardo = a => !a.fatto && a.data && a.data < oggiIso();
  const quando = a => [giorno(a.data), a.ora].filter(Boolean).join(', ') || 'Senza data';
  const primoContatto = c => { const a = appOrdinati(c).find(x => x.fatto && x.data); return a ? a.data : ''; };
  const ultimoIncontro = c => { const f = appOrdinati(c).filter(x => x.fatto && x.data); return f.length ? f[f.length - 1].data : ''; };

  // La cosa più utile da mostrare sotto il nome del cliente.
  function prossimaCosa(c) {
    const p = prossimoApp(c);
    if (p && inRitardo(p)) return { cls: 'ritardo', testo: `${etichettaApp(c, p)} in ritardo · ${quando(p)}` };
    const mia = AZIONI_F.find(a => a.mia && a.f(c));
    if (mia) return { cls: 'da-fare', testo: conRef(mia.breve) };
    if (p) return { cls: '', testo: `${etichettaApp(c, p)} · ${quando(p)}` };
    const attesa = AZIONI_F.find(a => !a.mia && a.f(c));
    if (attesa) return { cls: '', testo: conRef(attesa.breve) };
    return null;
  }

  /* =====================================================================
     NAVIGAZIONE
     ===================================================================== */
  function vai(p) {
    pagina = p;
    $$('[data-pagina]').forEach(s => { s.hidden = s.dataset.pagina !== p; });
    $$('[data-vai]').forEach(b => b.removeAttribute('aria-current'));
    $$('[data-vai]').forEach(b => { if (b.dataset.vai === p) b.setAttribute('aria-current', 'page'); });
    disegna();
    window.scrollTo(0, 0);
  }
  function disegna() {
    disegnaBadge();
    if (pagina === 'dafare') disegnaDaFare();
    else if (pagina === 'clienti') disegnaClienti();
    else if (pagina === 'agenda') disegnaAgenda();
    else if (pagina === 'studio') disegnaStudio();
    else disegnaDati();
  }

  /* =====================================================================
     DA FARE
     ===================================================================== */
  function bisognoBackup() {
    if (!clienti.length) return null;
    let ultimo = null;
    try { ultimo = localStorage.getItem(CHIAVE_EXPORT); } catch (e) {}
    const modificato = clienti.some(c => !ultimo || (c.aggiornato || '') > ultimo);
    const giorni = ultimo ? (Date.now() - new Date(ultimo)) / 864e5 : Infinity;
    return modificato && giorni >= 3 ? (ultimo ? `Ultimo backup ${dataOraIt(ultimo)}` : 'Non hai ancora fatto un backup') : null;
  }

  function sezioniDaFare() {
    const oggi = oggiIso();
    const app = [];
    clienti.forEach(c => c.appuntamenti.forEach(a => { if (!a.fatto && a.data && a.data <= oggi) app.push({ c, a }); }));
    app.sort((x, y) => chiaveApp(x.a).localeCompare(chiaveApp(y.a)));
    const sez = [];
    const ritardo = app.filter(x => x.a.data < oggi);
    const diOggi = app.filter(x => x.a.data === oggi);
    if (ritardo.length) sez.push({ titolo: 'Appuntamenti in ritardo', cls: 'ritardo', voci: ritardo.map(({ c, a }) => ({ c, sotto: `${etichettaApp(c, a)} · ${quando(a)}`, tab: 'appuntamenti' })) });
    if (diOggi.length) sez.push({ titolo: 'Oggi', voci: diOggi.map(({ c, a }) => ({ c, sotto: `${a.ora || 'In giornata'} · ${etichettaApp(c, a)}`, tab: 'appuntamenti' })) });
    AZIONI_F.filter(a => a.mia).forEach(az => {
      const voci = clienti.filter(az.f).map(c => ({ c, sotto: [c.citta, c.referente].filter(Boolean).join(' · ') || nomeStato(c), tab: az.tab }));
      if (voci.length) sez.push({ titolo: conRef(az.titolo), voci });
    });
    const attese = [];
    AZIONI_F.filter(a => !a.mia).forEach(az => clienti.filter(az.f).forEach(c => attese.push({ c, sotto: conRef(az.titolo), tab: az.tab })));
    return { sez, attese };
  }

  function disegnaBadge() {
    const n = sezioniDaFare().sez.reduce((s, x) => s + x.voci.length, 0);
    const b = $('#badge-dafare');
    b.hidden = !n; b.textContent = n;
  }

  function righe(voci) {
    return `<div class="gruppo">${voci.map(v => `
      <button class="riga" data-apri="${esc(v.c.id)}" data-tab-apri="${v.tab}">
        <span class="riga-testo"><span class="cliente-nome">${esc(nome(v.c))}</span><small>${esc(v.sotto)}</small></span>${CHEV}
      </button>`).join('')}</div>`;
  }

  function disegnaDaFare() {
    const { sez, attese } = sezioniDaFare();
    const n = sez.reduce((s, x) => s + x.voci.length, 0);
    $('#sub-dafare').textContent = !clienti.length ? 'Inizia aggiungendo un cliente' : n ? (n === 1 ? '1 cosa da fare' : `${n} cose da fare`) : 'Tutto in ordine';
    let html = '';
    const backup = bisognoBackup();
    if (backup) html += `<div class="gruppo"><button class="riga" data-vai-a="dati"><span class="riga-testo"><span>Fai un backup</span><small>${esc(backup)}</small></span>${CHEV}</button></div>`;
    const ripasso = promemoriaStudio();
    if (ripasso) html += `<div class="gruppo"><button class="riga" data-vai-a="studio"><span class="riga-testo"><span>Ripassa prima delle visite</span><small>${esc(ripasso)}</small></span>${CHEV}</button></div>`;
    sez.forEach(s => { html += `<h3 class="titolo-gruppo ${s.cls || ''}">${esc(s.titolo)} · ${s.voci.length}</h3>${righe(s.voci)}`; });
    if (!clienti.length) {
      html += `<div class="vuoto">${ICONA('clienti')}<strong>Nessun cliente</strong>Tocca + per inserire il primo locale.</div>`;
    } else if (!sez.length) {
      html += `<div class="vuoto">${ICONA('spunta')}<strong>Niente da fare adesso</strong>Le prossime azioni compariranno qui.</div>`;
    }
    if (attese.length) html += `<h3 class="titolo-gruppo attesa">In attesa di altri · ${attese.length}</h3>${righe(attese)}`;
    $('#dafare').innerHTML = html;
  }

  /* =====================================================================
     CLIENTI
     ===================================================================== */
  function disegnaClienti() {
    const q = $('#cerca').value.trim().toLowerCase();
    const filtro = { attivi: attivo, completati: completato, fermi: c => !!c.esito, tutti: () => true }[filtroClienti];
    $$('#filtro-clienti [data-filtro]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.filtro === filtroClienti)));
    const elenco = clienti.filter(filtro)
      .filter(c => !q || [c.nomeLocale, c.citta, c.referente, c.ragioneSociale].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.aggiornato || '').localeCompare(a.aggiornato || ''));
    const attivi = clienti.filter(attivo).length, fatti = clienti.filter(completato).length;
    $('#sub-clienti').textContent = clienti.length
      ? `${attivi} attivi${fatti ? ` · ${fatti} ${fatti === 1 ? 'completato' : 'completati'}` : ''} su ${clienti.length}` : 'Nessun cliente';
    if (!elenco.length) {
      $('#lista-clienti').innerHTML = clienti.length
        ? '<div class="vuoto piccolo">Nessun cliente con questi criteri.</div>'
        : `<div class="vuoto">${ICONA('clienti')}<strong>Nessun cliente</strong>Tocca + per inserire il primo locale.</div>`;
      return;
    }
    $('#lista-clienti').innerHTML = `<div class="gruppo">${elenco.map(c => {
      const p = prossimaCosa(c) || (completato(c) && c.fornitore.dataCommPagata
        ? { cls: '', testo: `Commissione incassata il ${dataIt(c.fornitore.dataCommPagata)}` } : null);
      const info = [c.citta, nomeStato(c)].filter(Boolean).join(' · ');
      return `<button class="riga" data-apri="${esc(c.id)}">
        <span class="riga-testo">
          <span class="cliente-nome">${esc(nome(c))}</span>
          <small>${esc(info)}</small>
          ${p ? `<span class="azione ${p.cls}">${esc(p.testo)}</span>` : ''}
        </span>${CHEV}</button>`;
    }).join('')}</div>`;
  }

  /* =====================================================================
     AGENDA
     ===================================================================== */
  function disegnaAgenda() {
    const oggi = oggiIso();
    const tutti = [];
    clienti.forEach(c => c.appuntamenti.forEach(a => { if (!a.fatto) tutti.push({ c, a }); }));
    tutti.sort((x, y) => chiaveApp(x.a).localeCompare(chiaveApp(y.a)));
    $('#sub-agenda').textContent = tutti.length ? (tutti.length === 1 ? '1 appuntamento in programma' : `${tutti.length} appuntamenti in programma`) : 'Nessun appuntamento';
    if (!tutti.length) {
      $('#agenda').innerHTML = `<div class="vuoto">${ICONA('agenda')}<strong>Agenda libera</strong>Aggiungi gli appuntamenti dalla scheda del cliente.</div>`;
      return;
    }
    const gruppi = [];
    tutti.forEach(x => {
      const chiave = !x.a.data ? 'senza' : x.a.data < oggi ? 'ritardo' : x.a.data;
      let g = gruppi.find(y => y.chiave === chiave);
      if (!g) {
        g = { chiave, voci: [], titolo: chiave === 'senza' ? 'Senza data' : chiave === 'ritardo' ? 'In ritardo' : giorno(chiave, true) };
        gruppi.push(g);
      }
      g.voci.push(x);
    });
    gruppi.sort((a, b) => (a.chiave === 'ritardo' ? -1 : b.chiave === 'ritardo' ? 1 : a.chiave.localeCompare(b.chiave)));
    $('#agenda').innerHTML = gruppi.map(g => `
      <h3 class="titolo-gruppo ${g.chiave === 'ritardo' ? 'ritardo' : ''}">${esc(g.titolo)}</h3>
      <div class="gruppo">${g.voci.map(({ c, a }) => `
        <div class="riga">
          <button class="spunta" data-svolto="${esc(a.id)}" data-cliente="${esc(c.id)}" aria-pressed="false" aria-label="Segna come svolto">${ICONA('spunta')}</button>
          <span class="ora">${esc(g.chiave === 'ritardo' ? giorno(a.data).replace(/^(\w+) /, '') : (a.ora || '—'))}</span>
          <button class="riga-testo" data-apri="${esc(c.id)}" data-tab-apri="appuntamenti" style="text-align:left">
            <span class="cliente-nome">${esc(nome(c))}</span>
            <small>${esc(etichettaApp(c, a))}${a.note ? ' · ' + esc(a.note) : ''}</small>
          </button>
        </div>`).join('')}</div>`).join('');
  }

  function segnaSvolto(c, a) {
    if (!confirm(`Segnare come svolto?\n\n${etichettaApp(c, a)} · ${nome(c)}\n${quando(a)}`)) return false;
    a.fatto = true; tocca(c); salvaTutto();
    toast(`${etichettaApp(c, a)} segnato come svolto`);
    return true;
  }

  /* =====================================================================
     STUDIO — materiale da ripassare prima delle visite.
     Il contenuto arriva da un file .json caricato in Dati: non è nel codice,
     resta solo su questo telefono (e nel backup), come le Impostazioni.
     Formato: { tipo: 'studio', titolo, aggiornato, argomenti: [{ id, titolo, intro, schede: [{ id, titolo, domanda, testo }] }],
                checklist: [{ id, testo }] }
     Nel testo: righe «- » = elenco, righe «| a | b |» = tabella, **grassetto**, riga vuota = nuovo paragrafo.
     ===================================================================== */
  const CHIAVE_STUDIO = 'flpit_studio';
  const CHIAVE_PROG = 'flpit_studio_progressi';
  const CHIAVE_CHECK = 'flpit_studio_checklist';
  const leggiJson = (k, base) => { try { const d = JSON.parse(localStorage.getItem(k) || 'null'); return d && typeof d === 'object' ? d : base; } catch (e) { return base; } };
  const scriviJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Impossibile salvare sul telefono'); return false; } };
  let studio = leggiJson(CHIAVE_STUDIO, null);
  let progressi = leggiJson(CHIAVE_PROG, {});   // { idScheda: { stato: 'imparata' | 'ripassare', data } }
  let checklist = leggiJson(CHIAVE_CHECK, {});  // { idVoce: true }
  let vistaStudio = { tipo: 'home' };           // home | argomento | ripasso
  let cercaStudio = '';

  const tutteSchede = () => (studio ? studio.argomenti.flatMap(a => a.schede.map(s => ({ ...s, argomento: a }))) : []);
  const imparata = s => (progressi[s.id] || {}).stato === 'imparata';
  const daRipassare = s => (progressi[s.id] || {}).stato === 'ripassare';
  const contaImparate = schede => schede.filter(imparata).length;

  function validaStudio(d) {
    if (!d || d.tipo !== 'studio' || !Array.isArray(d.argomenti)) throw new Error('il file non è un materiale di studio.');
    const ids = new Set();
    d.argomenti.forEach((a, i) => {
      if (!a || !a.titolo || !Array.isArray(a.schede)) throw new Error(`argomento ${i + 1} incompleto.`);
      a.id = String(a.id || `arg${i + 1}`);
      a.schede.forEach((s, j) => {
        if (!s || !s.titolo) throw new Error(`scheda ${j + 1} di «${a.titolo}» senza titolo.`);
        s.id = String(s.id || `${a.id}-${j + 1}`);
        if (ids.has(s.id)) throw new Error(`scheda ripetuta: ${s.id}.`);
        ids.add(s.id);
      });
    });
    d.checklist = Array.isArray(d.checklist) ? d.checklist.map((c, i) => ({ id: String(c.id || `c${i + 1}`), testo: String(c.testo || c) })) : [];
    return d;
  }
  function importaStudio(testo) {
    let d;
    try { d = JSON.parse(testo); } catch (e) { throw new Error('il file non è un .json valido.'); }
    studio = validaStudio(d);
    scriviJson(CHIAVE_STUDIO, studio);
    vistaStudio = { tipo: 'home' };
    return tutteSchede().length;
  }
  function segnaScheda(id, stato) {
    if (stato) progressi[id] = { stato, data: oggiIso() }; else delete progressi[id];
    scriviJson(CHIAVE_PROG, progressi);
  }

  // Testo semplice → HTML sicuro (si parte sempre da esc()).
  function formatta(testo) {
    const grassetto = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const blocchi = [];
    let elenco = null, tabella = null, para = [];
    const chiudi = () => {
      if (para.length) { blocchi.push(`<p>${para.map(grassetto).join('<br>')}</p>`); para = []; }
      if (elenco) { blocchi.push(`<ul>${elenco.map(x => `<li>${grassetto(x)}</li>`).join('')}</ul>`); elenco = null; }
      if (tabella) {
        const celle = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const righeT = tabella.filter(r => !/^\|[\s\-:|]+\|$/.test(r)).map(celle);
        const testa = righeT[0], corpo = righeT.slice(1);
        blocchi.push(`<div class="tabella"><table><thead><tr>${testa.map(c => `<th>${grassetto(c)}</th>`).join('')}</tr></thead><tbody>${corpo.map(r => `<tr>${r.map(c => `<td>${grassetto(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        tabella = null;
      }
    };
    String(testo || '').split('\n').forEach(riga => {
      const t = riga.trim();
      if (!t) { chiudi(); return; }
      if (/^\|.*\|$/.test(t)) { if (!tabella) { chiudi(); tabella = []; } tabella.push(t); return; }
      if (/^[-•] /.test(t)) { if (!elenco) { chiudi(); elenco = []; } elenco.push(t.slice(2)); return; }
      if (elenco || tabella) chiudi();
      para.push(t);
    });
    chiudi();
    return blocchi.join('');
  }

  // Ordine del ripasso: prima quelle segnate «da ripassare», poi le mai viste; se sono tutte imparate, ripasso generale.
  function codaRipasso(idArgomento) {
    const schede = tutteSchede().filter(s => !idArgomento || s.argomento.id === idArgomento);
    const nonImparate = [...schede.filter(daRipassare), ...schede.filter(s => !progressi[s.id])];
    return (nonImparate.length ? nonImparate : schede).map(s => s.id);
  }
  const schedaPerId = id => tutteSchede().find(s => s.id === id);

  // Visite di oggi e domani ancora da fare (per il promemoria in «Da fare»).
  function visiteVicine() {
    const giorni = [oggiIso(), traGiorni(1)];
    return clienti.filter(aperto).filter(c => c.appuntamenti.some(a => !a.fatto && a.tipo === 'incontro' && giorni.includes(a.data))).length;
  }
  function promemoriaStudio() {
    if (!studio) return null;
    const n = visiteVicine();
    const restano = tutteSchede().filter(s => !imparata(s)).length;
    if (!n || !restano) return null;
    return `${n === 1 ? '1 visita' : n + ' visite'} tra oggi e domani · ${restano === 1 ? '1 scheda' : restano + ' schede'} da ripassare`;
  }

  function cartaScheda(s, conArgomento) {
    const fatta = imparata(s), ripassa = daRipassare(s);
    return `<article class="studio-scheda" id="scheda-${esc(s.id)}">
      ${conArgomento ? `<p class="studio-arg">${esc(s.argomento.titolo)}</p>` : ''}
      <h4>${esc(s.titolo)}</h4>
      <div class="testo-studio">${formatta(s.testo)}</div>
      <div class="studio-piede">
        <button type="button" class="studio-segna" data-studio-segna="${esc(s.id)}" aria-pressed="${fatta}">
          <span class="spunta" aria-pressed="${fatta}">${ICONA('spunta')}</span><span>${fatta ? 'Imparata' : 'Segna come imparata'}</span>
        </button>
        ${ripassa ? '<span class="etichetta-ripassare">Da ripassare</span>' : ''}
      </div>
    </article>`;
  }

  function disegnaStudio() {
    const box = $('#studio');
    $('#testata-studio').hidden = vistaStudio.tipo !== 'home';
    if (!studio) {
      $('#testata-studio').hidden = false;
      $('#sub-studio').textContent = 'Nessun materiale caricato';
      box.innerHTML = `<div class="vuoto">${ICONA('studio')}<strong>Niente da studiare ancora</strong>Carica il file del materiale di studio: resta solo su questo telefono.</div>
        <button type="button" class="btn-primario" data-studio="carica">Carica materiale di studio</button>`;
      return;
    }
    const schede = tutteSchede();
    const fatte = contaImparate(schede);

    if (vistaStudio.tipo === 'argomento') {
      const a = studio.argomenti.find(x => x.id === vistaStudio.id);
      if (!a) { vistaStudio = { tipo: 'home' }; disegnaStudio(); return; }
      const lista = a.schede.map(s => ({ ...s, argomento: a }));
      box.innerHTML = `<header class="nav"><button type="button" class="btn-nav" data-studio="home">${ICONA('indietro')}<span>Studio</span></button></header>
        <div class="scheda-testa"><h2>${esc(a.titolo)}</h2><p class="sottotitolo">${contaImparate(lista)} di ${lista.length} imparate</p></div>
        ${a.intro ? `<div class="testo-studio intro">${formatta(a.intro)}</div>` : ''}
        ${lista.map(s => cartaScheda(s)).join('')}
        <button type="button" class="btn-secondario" data-studio="ripasso" data-arg="${esc(a.id)}">Ripassa questo argomento</button>`;
      return;
    }

    if (vistaStudio.tipo === 'ripasso') {
      const v = vistaStudio;
      const testaR = `<header class="nav"><button type="button" class="btn-nav" data-studio="home">${ICONA('indietro')}<span>Fine</span></button><span class="salvataggio">${Math.min(v.i + 1, v.coda.length)} di ${v.coda.length}</span></header>
        <div class="barra-progresso"><i style="width:${v.coda.length ? Math.round(v.i / v.coda.length * 100) : 100}%"></i></div>`;
      if (v.i >= v.coda.length) {
        box.innerHTML = testaR + `<div class="vuoto">${ICONA('spunta')}<strong>Ripasso finito</strong>${v.so} sapute, ${v.no} da ripassare.<br>In tutto ${fatte} di ${schede.length} schede imparate.</div>
          ${v.no ? `<button type="button" class="btn-primario" data-studio="ripasso" data-arg="${esc(v.arg || '')}">Ripassa quelle da rivedere</button>` : ''}
          <button type="button" class="btn-secondario" data-studio="home">Torna allo Studio</button>`;
        return;
      }
      const s = schedaPerId(v.coda[v.i]);
      if (!s) { v.i++; disegnaStudio(); return; }
      box.innerHTML = testaR + `<article class="ripasso-carta">
          <p class="studio-arg">${esc(s.argomento.titolo)}</p>
          <h3 class="ripasso-domanda">${esc(s.domanda || s.titolo)}</h3>
          ${v.mostra ? `<div class="testo-studio">${formatta(s.testo)}</div>` : ''}
        </article>
        ${v.mostra
          ? `<div class="due-bottoni"><button type="button" class="btn-tenue" data-studio="risposta" data-esito="ripassare">Da ripassare</button><button type="button" class="btn-pieno" data-studio="risposta" data-esito="imparata">La so</button></div>`
          : `<button type="button" class="btn-primario" data-studio="mostra">Mostra la risposta</button>`}`;
      return;
    }

    // HOME
    $('#sub-studio').textContent = `${fatte} di ${schede.length} schede imparate${studio.aggiornato ? ' · materiale del ' + dataIt(studio.aggiornato) : ''}`;
    let html = `<input id="cerca-studio" class="ricerca" type="search" placeholder="Cerca: prezzo, spedizione, garanzia…" autocomplete="off" value="${esc(cercaStudio)}">`;
    const q = cercaStudio.trim().toLowerCase();
    if (q) {
      const parole = q.split(/\s+/);
      const trovate = schede.filter(s => { const t = `${s.titolo} ${s.domanda || ''} ${s.testo || ''} ${s.argomento.titolo}`.toLowerCase(); return parole.every(p => t.includes(p)); });
      html += trovate.length ? trovate.map(s => cartaScheda(s, true)).join('') : `<div class="vuoto piccolo">Nessuna scheda contiene «${esc(cercaStudio.trim())}».</div>`;
      box.innerHTML = html;
      return;
    }
    const restano = schede.filter(s => !imparata(s)).length;
    html += `<div class="barra-progresso grande"><i style="width:${schede.length ? Math.round(fatte / schede.length * 100) : 0}%"></i></div>
      <button type="button" class="btn-primario" data-studio="ripasso">${restano ? `Ripassa · ${restano} ${restano === 1 ? 'scheda' : 'schede'}` : 'Ripasso generale'}</button>`;
    if (studio.checklist.length) {
      const nFatte = studio.checklist.filter(c => checklist[c.id]).length;
      html += `<h3 class="titolo-gruppo con-azione">Prima della visita · ${nFatte}/${studio.checklist.length}${nFatte ? '<button type="button" class="btn-link" data-studio="azzera">Azzera</button>' : ''}</h3>
        <div class="gruppo">${studio.checklist.map(c => `<button type="button" class="riga" data-check="${esc(c.id)}">
          <span class="spunta" aria-pressed="${!!checklist[c.id]}">${ICONA('spunta')}</span>
          <span class="riga-testo"><small class="a-capo voce-check${checklist[c.id] ? ' fatta' : ''}">${esc(c.testo)}</small></span></button>`).join('')}</div>`;
    }
    html += `<h3 class="titolo-gruppo">Argomenti</h3><div class="gruppo">${studio.argomenti.map(a => {
      const lista = a.schede.map(s => ({ ...s, argomento: a }));
      const f = contaImparate(lista), r = lista.filter(daRipassare).length;
      return `<button type="button" class="riga" data-studio="argomento" data-arg="${esc(a.id)}">
        <span class="riga-testo"><span>${esc(a.titolo)}</span><small>${f} di ${lista.length} imparate${r ? ` · ${r} da ripassare` : ''}</small></span>
        ${f === lista.length && lista.length ? `<span class="segno-ok">${ICONA('spunta')}</span>` : ''}${CHEV}</button>`;
    }).join('')}</div>`;
    box.innerHTML = html;
  }

  function apriFileStudio() { $('#file-studio').click(); }

  /* =====================================================================
     DATI
     ===================================================================== */
  function disegnaDati() {
    let ultimo = null;
    try { ultimo = localStorage.getItem(CHIAVE_EXPORT); } catch (e) {}
    const nApp = clienti.reduce((s, c) => s + c.appuntamenti.length, 0);
    $('#sub-dati').textContent = `${clienti.length} clienti · ${nApp} appuntamenti`;
    $('#info-dati').textContent = `I dati sono salvati solo su questo telefono. ${ultimo ? 'Ultimo export: ' + dataOraIt(ultimo) + '.' : 'Non hai ancora esportato nulla.'} Salva un backup ogni pochi giorni in File o iCloud Drive.`;
    $$('[data-imp]').forEach(el => { if (document.activeElement !== el) el.value = imp[el.dataset.imp] || ''; });
    $('#info-studio').textContent = studio
      ? `${studio.titolo || 'Materiale'}${studio.aggiornato ? ' del ' + dataIt(studio.aggiornato) : ''} · ${tutteSchede().length} schede · tocca per sostituirlo`
      : 'File .json preparato per te';
  }

  // Nomi che dipendono dalle Impostazioni (referente del fornitore, commissione).
  function applicaNomi() {
    $$('[data-ref]').forEach(el => { el.textContent = conRef(el.dataset.ref); });
    $$('[data-azienda]').forEach(el => { el.textContent = (imp.azienda || '').trim() ? ` (${imp.azienda.trim()})` : ''; });
    const perc = String(imp.commissione || '').replace(/[^\d.,]/g, '');
    $('#titolo-commissione').textContent = perc ? `Commissione ${perc}%` : 'Commissione';
  }

  /* =====================================================================
     CONTROLLI SUI CAMPI — solo avvisi, mai blocchi (è obbligatorio solo il nome).
     «normalizza» corregge il valore quando si esce dal campo;
     «verifica» restituisce un avviso (testo) o { testo, correzione } con il bottone «Usa …».
     ===================================================================== */
  const spazi = v => String(v || '').replace(/[ \t]+/g, ' ').trim();
  const righePulite = v => String(v || '').split('\n').map(spazi).filter(Boolean).join('\n');
  const chiaveNome = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const tuttoUguale = v => v === v.toLowerCase() || v === v.toUpperCase(); // scritto tutto minuscolo o tutto maiuscolo
  const PICCOLE = ['di', 'de', 'del', 'della', 'dei', 'degli', 'delle', 'la', 'lo', 'le', 'il', 'e', 'in', 'sul', 'sulla', 'a', 'al'];
  function maiuscole(v, conPiccole) {
    const s = spazi(v);
    if (!s || !tuttoUguale(s)) return s; // se l'ha già scritto con le maiuscole, non lo tocco
    return s.toLowerCase().split(' ').map((w, i) => (conPiccole && i > 0 && PICCOLE.includes(w)) ? w
      : w.replace(/(^|['’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())).join(' ');
  }
  function distanza(a, b) { // Levenshtein, per «Catana» → «Catania»
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const altri = c => clienti.filter(x => x !== c && x.id !== c.id);
  const cittaUsate = c => [...new Set(altri(c).map(x => spazi(x.citta)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));

  // Telefono: +39 se manca, cellulare come +39 333 123 4567.
  function normTelefono(v) {
    const s = spazi(v);
    if (!s || !/^[\d\s+().\/-]+$/.test(s)) return s; // contiene lettere: lo lascio com'è
    let n = s.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '').replace(/^00/, '+');
    if (!n.startsWith('+')) n = (/^39\d{9,10}$/.test(n) ? '+' : '+39') + n;
    const m = /^\+39(\d+)$/.exec(n);
    if (!m) return s.replace(/^00/, '+'); // numero estero: lascio la sua formattazione
    const d = m[1];
    if (d[0] === '3' && d.length === 10) return `+39 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
    return `+39 ${d}`;
  }
  function verTelefono(v) {
    if (!v) return '';
    if (!/^[\d\s+().\/-]+$/.test(v)) return 'Il numero contiene lettere';
    const n = v.replace(/[^\d+]/g, '');
    const m = /^\+39(\d*)$/.exec(n);
    if (!m) return n.replace(/\D/g, '').length < 7 || n.length > 16 ? 'Numero estero: controlla le cifre' : '';
    const d = m[1];
    if (d[0] === '3') return d.length < 9 || d.length > 10 ? `Un cellulare italiano ha 10 cifre (qui ${d.length})` : '';
    if (d[0] === '0') return d.length < 6 || d.length > 11 ? `Un fisso italiano ha da 6 a 11 cifre (qui ${d.length})` : '';
    return 'Un numero italiano inizia per 3 (cellulare) o 0 (fisso)';
  }

  const DOMINI_SBAGLIATI = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.it': 'gmail.com', 'gmail.con': 'gmail.com',
    'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'hotmial.it': 'hotmail.it', 'hotmial.com': 'hotmail.com',
    'hotmail.con': 'hotmail.com', 'hotmai.it': 'hotmail.it', 'libero.ti': 'libero.it', 'libero.com': 'libero.it', 'liber.it': 'libero.it',
    'yahooo.it': 'yahoo.it', 'yaho.it': 'yahoo.it', 'yahoo.ti': 'yahoo.it', 'outlok.it': 'outlook.it', 'outlook.con': 'outlook.com',
    'icloud.it': 'icloud.com', 'iclod.com': 'icloud.com', 'tiscali.ti': 'tiscali.it', 'alice.ti': 'alice.it', 'virgilio.ti': 'virgilio.it'
  };

  // Partita IVA italiana: 11 cifre, l'ultima è di controllo.
  function pivaValida(p) {
    let s = 0;
    for (let i = 0; i < 10; i++) { let x = +p[i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } s += x; }
    return (10 - s % 10) % 10 === +p[10];
  }
  const PROVINCE = ('AG AL AN AO AP AQ AR AT AV BA BG BI BL BN BO BR BS BT BZ CA CB CE CH CL CN CO CR CS CT CZ EN FC FE FG FI FM FR GE GO GR ' +
    'IM IS KR LC LE LI LO LT LU MB MC ME MI MN MO MS MT NA NO NU OR PA PC PD PE PG PI PN PO PR PT PU PV PZ RA RC RE RG RI RM RN RO ' +
    'SA SI SO SP SR SS SU SV TA TE TN TO TP TR TS TV UD VA VB VC VE VI VR VT VV').split(' ');
  function normIndirizzo(v) {
    return righePulite(v).replace(/\(([a-z]{2})\)/gi, (m, p) => PROVINCE.includes(p.toUpperCase()) ? `(${p.toUpperCase()})` : m);
  }
  function verIndirizzo(v) {
    if (!v) return '';
    const cap = /(^|\D)\d{5}(\D|$)/.test(v);
    const prov = (v.match(/\b[A-Z]{2}\b/g) || []).some(p => PROVINCE.includes(p));
    if (!cap && !prov) return 'Manca il CAP (5 cifre) e la sigla della provincia (es. CT)';
    if (!cap) return 'Manca il CAP (5 cifre)';
    if (!prov) return 'Manca la sigla della provincia (es. CT)';
    return '';
  }

  const CONTROLLI = {
    nomeLocale: {
      normalizza: spazi,
      verifica: (v, c) => {
        const k = chiaveNome(v);
        const doppio = k && altri(c).find(x => chiaveNome(x.nomeLocale) === k);
        if (!doppio) return '';
        const stessaCitta = chiaveNome(doppio.citta) && chiaveNome(doppio.citta) === chiaveNome(c.citta);
        return `${stessaCitta ? 'Esiste già' : 'Attenzione: esiste già'} un cliente «${doppio.nomeLocale}»${doppio.citta ? ' a ' + doppio.citta : ''} (${nomeStato(doppio)})`;
      }
    },
    citta: {
      normalizza: (v, c) => {
        const s = maiuscole(v, true);
        return cittaUsate(c).find(x => x.toLowerCase() === s.toLowerCase()) || s;
      },
      verifica: (v, c) => {
        if (!v) return '';
        const usate = cittaUsate(c);
        if (usate.some(x => x.toLowerCase() === v.toLowerCase())) return '';
        const simile = usate.find(x => distanza(x.toLowerCase(), v.toLowerCase()) <= (v.length > 5 ? 2 : 1));
        return simile ? { testo: `Forse intendevi «${simile}»?`, correzione: simile } : '';
      }
    },
    referente: { normalizza: v => maiuscole(v, false) },
    telefono: { normalizza: normTelefono, verifica: verTelefono },
    telefonoConsegna: { normalizza: normTelefono, verifica: verTelefono },
    email: {
      normalizza: v => String(v || '').replace(/\s+/g, '').toLowerCase(),
      verifica: v => {
        if (!v) return '';
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) return 'L\'email non sembra valida (es. nome@gmail.com)';
        const [u, dom] = v.split('@');
        return DOMINI_SBAGLIATI[dom] ? { testo: `Forse intendevi ${u}@${DOMINI_SBAGLIATI[dom]}?`, correzione: `${u}@${DOMINI_SBAGLIATI[dom]}` } : '';
      }
    },
    ragioneSociale: {
      normalizza: spazi,
      verifica: v => !v || /(^|[^\p{L}])(s\.?\s?r\.?\s?l(\.?\s?s)?|s\.?\s?n\.?\s?c|s\.?\s?a\.?\s?s|s\.?\s?p\.?\s?a|s\.?\s?s|soc|coop|società|ditta|impresa individuale)\.?(?!\p{L})/iu.test(v) ? ''
        : 'Manca la forma giuridica? (S.r.l., S.r.l.s., S.n.c., S.a.s., S.p.A., ditta individuale)'
    },
    partitaIva: {
      normalizza: v => String(v || '').replace(/[\s.\-]/g, '').replace(/^IT/i, ''),
      verifica: v => {
        if (!v) return '';
        const p = v.replace(/\s/g, '').replace(/^IT/i, '');
        if (!/^\d{11}$/.test(p)) return `La Partita IVA italiana ha 11 cifre${/^\d+$/.test(p) ? ` (qui ${p.length})` : ''}`;
        return pivaValida(p) ? '' : 'La cifra finale non torna: controlla la Partita IVA';
      }
    },
    indirizzoFatturazione: { normalizza: normIndirizzo, verifica: verIndirizzo },
    indirizzoConsegna: { normalizza: normIndirizzo, verifica: verIndirizzo }
  };

  // Mostra l'avviso di un campo della scheda.
  function avvisoCampo(nomeCampo) {
    const ctl = CONTROLLI[nomeCampo];
    const em = $(`.avviso-campo[data-per="${nomeCampo}"]`);
    if (!ctl || !ctl.verifica || !em || !corrente) return;
    const r = ctl.verifica(spazi(leggi(corrente, nomeCampo)), corrente) || '';
    const testo = typeof r === 'string' ? r : r.testo;
    em.innerHTML = testo ? esc(testo) + (r.correzione ? ` <button type="button" class="btn-link" data-correggi="${esc(nomeCampo)}" data-valore="${esc(r.correzione)}">Usa «${esc(r.correzione)}»</button>` : '') : '';
  }
  const avvisiScheda = () => Object.keys(CONTROLLI).forEach(avvisoCampo);

  // Riepilogo dei dati per la fattura (mostrato prima di «Copia i dati per la fattura»).
  const mancantiFattura = c => CAMPI_FATTURA.filter(([k]) => !spazi(c[k]));
  function riepilogoFattura() {
    const c = corrente;
    const manca = mancantiFattura(c);
    const conAvviso = CAMPI_FATTURA.filter(([k]) => spazi(c[k]) && CONTROLLI[k] && CONTROLLI[k].verifica && CONTROLLI[k].verifica(spazi(c[k]), c));
    const n = CAMPI_FATTURA.length - manca.length;
    let t = `Dati per la fattura completi: ${n} di ${CAMPI_FATTURA.length}`;
    if (manca.length) t += ` · mancano: ${manca.map(x => x[1]).join(', ')}`;
    if (conAvviso.length) t += ` · da controllare: ${conAvviso.map(x => x[1]).join(', ')}`;
    const el = $('#riepilogo-fattura');
    el.textContent = t;
    el.classList.toggle('completo', !manca.length && !conAvviso.length);
    el.dataset.vaiCampo = (manca[0] || conAvviso[0] || [''])[0];
  }

  // Porta al campo indicato nella sezione Cliente.
  function vaiAlCampo(nomeCampo) {
    mostraTab('cliente');
    const el = $('#form')[nomeCampo];
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }

  /* =====================================================================
     SCHEDA CLIENTE
     ===================================================================== */
  function nuovoCliente() {
    const ora = new Date().toISOString();
    return normalizza({ creato: ora, aggiornato: ora, fase: 'contatto',
      appuntamenti: [{ tipo: 'incontro', data: oggiIso(), ora: oraAdesso(), fatto: true, note: '' }] });
  }

  function apriScheda(c, eNuovo, tabIniziale) {
    corrente = c; nuovo = eNuovo;
    scrollPagina = window.scrollY;
    $('#form').reset();
    $$('#form [name]').forEach(el => { el.value = leggi(c, el.name) || ''; });
    $$('#form .scelte[data-campo]').forEach(s => aggiornaScelte(s, leggi(c, s.dataset.campo)));
    $('#elenco-citta').innerHTML = cittaUsate(c).map(x => `<option value="${esc(x)}">`).join('');
    $('#testo-indietro').textContent = { dafare: 'Da fare', clienti: 'Clienti', agenda: 'Agenda', dati: 'Dati' }[pagina];
    $('#salvataggio').textContent = '';
    $('#principale').hidden = true; $('#tabbar').hidden = true; $('#scheda').hidden = false;
    mostraTab(tabIniziale || 'cliente');
    disegnaScheda();
    window.scrollTo(0, 0);
    if (eNuovo) setTimeout(() => $('#form').nomeLocale.focus(), 60);
  }

  function chiudiScheda() {
    if (corrente && nuovo && vuoto(corrente) && clienti.includes(corrente)) {
      clienti = clienti.filter(x => x !== corrente); salvaTutto();
    } else if (corrente && clienti.includes(corrente) && !(corrente.nomeLocale || '').trim()) {
      toast('Cliente salvato senza nome');
    }
    corrente = null; nuovo = false;
    $('#scheda').hidden = true; $('#principale').hidden = false; $('#tabbar').hidden = false;
    disegna();
    window.scrollTo(0, scrollPagina);
  }

  function mostraTab(t) {
    tab = t;
    $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('[data-pannello]').forEach(p => { p.hidden = p.dataset.pannello !== t; });
  }

  function disegnaScheda() {
    const c = corrente;
    $('#s-nome').textContent = c.nomeLocale || 'Nuovo cliente';
    $('#s-sotto').textContent = [c.citta, c.referente].filter(Boolean).join(' · ');
    // percorso
    const n = tappa(c);
    $('#percorso').classList.toggle('fermo', !!c.esito);
    $('#percorso').innerHTML = FASI.map((f, i) => `<li class="${i + 1 <= n ? 'raggiunta' : ''} ${i + 1 === n ? 'attuale' : ''}">
      <button type="button" data-fase="${f.id}" aria-label="${esc(f.nome)}" aria-pressed="${i + 1 === n}"><span class="barra"></span><span class="nome">${esc(f.breve)}</span></button></li>`).join('');
    $('#s-stato').innerHTML = c.esito
      ? `<strong>${esc(ESITO[c.esito].nome)}</strong> · tappa raggiunta: ${esc(FASE[c.fase].nome)}`
      : completato(c) ? `<strong>Completato</strong> · commissione incassata${c.fornitore.dataCommPagata ? ' il ' + esc(dataIt(c.fornitore.dataCommPagata)) : ''}`
      : `<strong>${esc(FASE[c.fase].nome)}</strong> · ${n} di ${FASI.length}`;
    $('#btn-ferma').textContent = c.esito ? 'Riapri' : 'Ferma trattativa';
    $('#btn-ferma').hidden = completato(c); // un cliente completato non ha una trattativa da fermare
    disegnaPassi();
    disegnaAppuntamenti();
    aggiornaAvvisi();
    const salvato = clienti.includes(c);
    $('#s-date').textContent = salvato ? `Creato ${dataOraIt(c.creato)} · modificato ${dataOraIt(c.aggiornato)}` : '';
    $('#btn-elimina').hidden = !salvato;
    const aperti = c.appuntamenti.filter(a => !a.fatto).length;
    $('[data-tab="appuntamenti"]').textContent = aperti ? `Appuntamenti · ${aperti}` : 'Appuntamenti';
    const mieF = AZIONI_F.filter(a => a.mia && a.tab === 'fornitore' && a.f(c)).length;
    $('[data-tab="fornitore"]').textContent = mieF ? `${refF()} · ${mieF}` : refF();
  }

  function salvaCorrente() {
    if (!corrente) return;
    tocca(corrente);
    if (!clienti.includes(corrente)) {
      if (vuoto(corrente)) { disegnaScheda(); return; }
      clienti.push(corrente);
    }
    if (salvaTutto()) {
      $('#salvataggio').textContent = 'Salvato';
      clearTimeout(timerSalvato);
      timerSalvato = setTimeout(() => { $('#salvataggio').textContent = ''; }, 1400);
    }
    disegnaScheda();
  }

  function aggiornaScelte(s, v) { s.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.valore === v))); }

  function aggiornaAvvisi() {
    const c = corrente;
    avvisiScheda();
    riepilogoFattura();
    $('#aiuto-commissione').textContent = completato(c) ? 'Commissione incassata: il cliente è completato.'
      : c.fornitore.commissione === 'pagata' ? 'Commissione incassata: il cliente sarà completato quando è a «Saldo pagato».'
      : c.fase === 'saldo' && c.fornitore.commissione === 'non_maturata'
      ? 'Il cliente ha saldato: la commissione è maturata. Spuntala.'
      : 'Matura quando il cliente ha pagato il saldo: allora si spunta da sola.';
    // Il numero fattura serve solo da quando la fattura è arrivata.
    const nf = $('#form')['fornitore.numeroFattura'];
    nf.closest('.gruppo').hidden = !(PASSI_F.fattura.passi.findIndex(p => p.id === c.fornitore.fattura) >= 1 || spazi(nf.value));
    avvisiPassi();
  }

  // ----- passi del fornitore (checklist) -----
  function disegnaPassi() {
    const c = corrente;
    Object.keys(PASSI_F).forEach(g => {
      const conf = PASSI_F[g];
      const idx = conf.passi.findIndex(p => p.id === c.fornitore[g]);
      const box = document.querySelector(`[data-passi="${g}"]`);
      box.innerHTML = conf.passi.map((p, i) => `
        <div class="passo ${i <= idx ? 'fatto' : ''}">
          <button type="button" class="spunta" data-gruppo="${g}" data-i="${i}" aria-pressed="${i <= idx}" aria-label="${esc(conRef(p.nome))}">${ICONA('spunta')}</button>
          <span class="riga-testo"><span>${esc(conRef(p.nome))}</span><em class="avviso-campo" data-avviso-passo="${p.data}"></em></span>
          ${i <= idx ? `<input type="date" name="fornitore.${p.data}" value="${esc(c.fornitore[p.data] || '')}" aria-label="Data">` : ''}
        </div>`).join('');
    });
  }

  // Date dei passi: non nel futuro, e non prima del passo precedente dello stesso gruppo.
  function avvisiPassi() {
    const c = corrente;
    const oggi = oggiIso();
    Object.keys(PASSI_F).forEach(g => {
      const conf = PASSI_F[g];
      const idx = conf.passi.findIndex(p => p.id === c.fornitore[g]);
      let prima = '';
      conf.passi.forEach((p, i) => {
        const em = $(`[data-avviso-passo="${p.data}"]`);
        if (!em) return;
        const d = i <= idx ? c.fornitore[p.data] || '' : '';
        em.textContent = !d ? '' : d > oggi ? 'Data nel futuro'
          : prima && d < prima ? `Data precedente al passo prima (${dataIt(prima)})` : '';
        if (d) prima = d;
      });
    });
  }

  function spuntaPasso(g, i) {
    const c = corrente;
    const conf = PASSI_F[g];
    const idx = conf.passi.findIndex(p => p.id === c.fornitore[g]);
    let avviso = '';
    if (i <= idx) {
      // togliere la spunta: torna al passo precedente (e toglie anche i successivi)
      c.fornitore[g] = i === 0 ? conf.base : conf.passi[i - 1].id;
    } else {
      c.fornitore[g] = conf.passi[i].id;
      for (let k = 0; k <= i; k++) { const d = conf.passi[k].data; if (!c.fornitore[d]) c.fornitore[d] = oggiIso(); }
      // Automatismo: la fattura mandata al cliente vuol dire che l'ordine è confermato.
      if (g === 'fattura' && conf.passi[i].id === 'inoltrata' && tappa(c) < FASE.ordine.n) {
        c.fase = 'ordine'; c.esito = '';
        avviso = 'Cliente passato a «Ordine confermato»';
      }
    }
    if (g === 'commissione' && i > idx && conf.passi[i].id === 'pagata') {
      avviso = completato(c) ? 'Cliente completato: ora è in Clienti › Completati'
        : 'Commissione incassata: il cliente sarà completato quando è a «Saldo pagato»';
    }
    salvaCorrente();
    if (avviso) toast(avviso);
    // Automatismo: fattura arrivata → si scrive subito il numero.
    if (g === 'fattura' && i > idx && i >= 1 && !spazi(c.fornitore.numeroFattura)) {
      const nf = $('#form')['fornitore.numeroFattura'];
      nf.scrollIntoView({ block: 'center' }); nf.focus({ preventScroll: true });
    }
  }

  // ----- stato -----
  function impostaFase(fase) {
    const c = corrente;
    const prima = tappa(c);
    const dopo = FASE[fase].n;
    // Automatismo: tornando indietro chiede conferma, perché i passi col fornitore restano spuntati.
    if (dopo < prima &&
        !confirm(`Tornare a «${FASE[fase].nome}»?\n\nI passi con ${refF()} già spuntati restano come sono.`)) return;
    c.fase = fase; c.esito = ''; c.dataEsito = '';
    let annulla = null;
    // Automatismo: al saldo la commissione matura.
    if (fase === 'saldo' && c.fornitore.commissione === 'non_maturata') {
      c.fornitore.commissione = 'maturata';
      const aveva = c.fornitore.dataCommMaturata;
      if (!aveva) c.fornitore.dataCommMaturata = oggiIso();
      annulla = () => { c.fornitore.commissione = 'non_maturata'; c.fornitore.dataCommMaturata = aveva; };
    }
    salvaCorrente();
    if (annulla) {
      toast('Commissione segnata come maturata', { testo: 'Annulla', f: () => { annulla(); if (corrente === c) salvaCorrente(); else { tocca(c); salvaTutto(); } } });
    }
    // Automatismo: all'ordine, se mancano dati per la fattura, porta al primo campo mancante.
    if (fase === 'ordine' && prima < dopo) {
      const manca = mancantiFattura(c);
      if (manca.length) {
        toast(`Per la fattura mancano: ${manca.map(x => x[1]).join(', ')}`);
        vaiAlCampo(manca[0][0]);
      }
    }
  }

  function apriFoglioFerma() {
    const c = corrente;
    apriFoglio(`
      <h4>${c.esito ? 'Riapri la trattativa' : 'Ferma la trattativa'}</h4>
      <p class="sottotitolo">${esc(nome(c))} · tappa raggiunta: ${esc(FASE[c.fase].nome)}</p>
      <div class="gruppo">
        ${ESITI.map(e => `<button class="riga" data-esito="${e.id}" aria-pressed="${c.esito === e.id}">
          <span class="riga-testo"><span>${esc(e.nome)}</span><small>${esc(e.spiega)}</small></span><svg class="segno"><use href="#i-spunta"/></svg></button>`).join('')}
        ${c.esito ? '<button class="riga" data-esito=""><span class="riga-testo"><span>Riapri</span><small>Torna attivo dalla tappa raggiunta</small></span></button>' : ''}
      </div>
      <p class="nota centro">La tappa raggiunta resta memorizzata.</p>`);
  }

  function impostaEsito(esito) {
    const c = corrente;
    c.esito = esito;
    c.dataEsito = esito ? oggiIso() : '';
    let msg = nomeStato(c);
    // Automatismo: un cliente rifiutato non deve lasciare appuntamenti in Agenda.
    const inProgramma = c.appuntamenti.filter(a => !a.fatto);
    if (esito === 'rifiutato' && inProgramma.length &&
        confirm(`Togliere dall'Agenda ${inProgramma.length === 1 ? 'l\'appuntamento in programma' : `i ${inProgramma.length} appuntamenti in programma`}?\n\n${inProgramma.map(a => `${etichettaApp(c, a)} · ${quando(a)}`).join('\n')}`)) {
      c.appuntamenti = c.appuntamenti.filter(a => a.fatto);
      msg += ` · ${inProgramma.length === 1 ? 'appuntamento tolto' : inProgramma.length + ' appuntamenti tolti'}`;
      salvaCorrente();
      toast(msg);
      proponiCalendario(c, inProgramma);
      return;
    }
    salvaCorrente();
    toast(msg);
  }

  // ----- appuntamenti -----
  function disegnaAppuntamenti() {
    const c = corrente;
    const lista = appOrdinati(c);
    const prossimi = lista.filter(a => !a.fatto);
    const svolti = lista.filter(a => a.fatto).reverse();
    const riga = a => `
      <div class="riga">
        <button type="button" class="spunta" data-app-svolto="${esc(a.id)}" aria-pressed="${a.fatto}" aria-label="Svolto">${ICONA('spunta')}</button>
        <button type="button" class="riga-testo" data-app-modifica="${esc(a.id)}" style="text-align:left">
          <span>${esc(etichettaApp(c, a))}</span>
          <small class="${inRitardo(a) ? 'ritardo-testo' : ''}">${esc(a.data ? `${giorno(a.data)}${a.ora ? ', ' + a.ora : ''}` : 'Senza data')}${inRitardo(a) ? ' · in ritardo' : ''}</small>
          ${a.note ? `<small class="a-capo">${esc(a.note)}</small>` : ''}
        </button>${CHEV}
      </div>`;
    let html = '';
    if (prossimi.length) html += `<h3 class="titolo-gruppo">In programma</h3><div class="gruppo">${prossimi.map(riga).join('')}</div>`;
    if (svolti.length) html += `<h3 class="titolo-gruppo">Svolti</h3><div class="gruppo">${svolti.map(riga).join('')}</div>`;
    if (!lista.length) html = '<div class="vuoto piccolo">Nessun appuntamento.</div>';
    $('#lista-app').innerHTML = html;
  }

  let appInModifica = null;
  let tipoScelto = 'incontro';
  let fattoScelto = false;

  function apriFoglioApp(a, proposta) {
    if (!(corrente.nomeLocale || '').trim()) {
      toast('Inserisci prima il nome del locale');
      mostraTab('cliente'); $('#form').nomeLocale.focus();
      return;
    }
    appInModifica = a || null;
    tipoScelto = a ? a.tipo : 'incontro';
    fattoScelto = a ? a.fatto : false;
    apriFoglio(`
      <h4>${a ? esc(etichettaApp(corrente, a)) : proposta ? 'Fissa il prossimo appuntamento?' : 'Nuovo appuntamento'}</h4>
      <p class="sottotitolo">${esc(nome(corrente))}${proposta ? ' · non ce ne sono altri in programma' : ''}</p>
      <div class="scelte" id="f-tipo">${TIPI_APP.map(t => `<button type="button" data-tipo="${t.id}" aria-pressed="${t.id === tipoScelto}">${esc(t.nome)}</button>`).join('')}</div>
      <div class="gruppo" style="margin-top:12px">
        <label class="campo"><span>Data</span><input id="f-data" type="date" value="${esc(a ? a.data : '')}"></label>
        <label class="campo"><span>Ora</span><input id="f-ora" type="time" value="${esc(a ? a.ora : '')}"></label>
        <label class="campo"><span>Note</span><textarea id="f-note" rows="2" placeholder="Obiettivo o esito">${esc(a ? a.note : '')}</textarea></label>
        <div class="passo"><button type="button" class="spunta" id="f-fatto" aria-pressed="${fattoScelto}" aria-label="Già svolto">${ICONA('spunta')}</button><span class="riga-testo"><span>Già svolto</span></span></div>
      </div>
      <em class="avviso-campo avviso-foglio" id="f-avviso"></em>
      <button type="button" class="btn-primario" data-azione="salva-app">${a ? 'Salva' : 'Aggiungi'}</button>
      ${proposta ? '<button type="button" class="btn-link centro-blocco" data-chiudi>Non ora</button>' : ''}
      ${a ? `<div class="azioni-foglio">
        ${!a.fatto && a.data ? `<button type="button" class="btn-link" data-azione="ics">${a.inCalendario ? 'Aggiorna nel Calendario' : 'Aggiungi al Calendario'}</button>` : '<span></span>'}
        <button type="button" class="btn-link pericolo" data-azione="elimina-app">Elimina</button></div>` : ''}`);
    avvisoApp();
  }

  // Avvisi del foglio appuntamento: data passata non svolta, stesso giorno e ora di un altro cliente.
  function avvisoApp() {
    const em = $('#f-avviso');
    if (!em) return;
    const data = $('#f-data').value, ora = $('#f-ora').value;
    const msg = [];
    if (data && !fattoScelto && data < oggiIso()) msg.push('La data è passata: se si è già svolto, spunta «Già svolto»');
    if (data && ora && !fattoScelto) {
      const conflitto = altri(corrente).find(x => x.appuntamenti.some(y => !y.fatto && y.data === data && y.ora === ora));
      if (conflitto) msg.push(`Alla stessa ora hai già un appuntamento con «${nome(conflitto)}»`);
    }
    em.textContent = msg.join(' · ');
  }

  function salvaApp() {
    const c = corrente;
    const dati = { tipo: tipoScelto, data: $('#f-data').value, ora: $('#f-ora').value, note: $('#f-note').value.trim(), fatto: fattoScelto };
    if (!dati.data) { toast('Inserisci la data'); $('#f-data').focus(); return; }
    const prima = appInModifica ? { ...appInModifica } : null;
    if (appInModifica) Object.assign(appInModifica, dati);
    else c.appuntamenti.push({ id: nuovoId(), ...dati });
    const spostato = prima && prima.inCalendario && !dati.fatto && (prima.data !== dati.data || prima.ora !== dati.ora);
    const modificato = appInModifica;
    let msg = appInModifica ? 'Appuntamento aggiornato' : 'Appuntamento aggiunto';
    // Automatismo: un appuntamento in programma vuol dire che la trattativa è iniziata.
    if (!dati.fatto && dati.data >= oggiIso() && c.fase === 'contatto' && !c.esito) {
      c.fase = 'trattativa';
      msg += ' · cliente passato a «In trattativa»';
    }
    chiudiFoglio();
    toast(msg);
    salvaCorrente();
    if (spostato) proponiCalendario(c, [prima], modificato);
  }

  // Automatismo: dopo un appuntamento svolto, se non ce ne sono altri, propone di fissare il prossimo.
  const serveProssimo = (c, a) => aperto(c) && c.fase !== 'saldo' && ['incontro', 'telefonata'].includes(a.tipo) && !c.appuntamenti.some(x => !x.fatto);

  // File .ics: su iPhone propone «Aggiungi al Calendario».
  // Un'app web non può togliere eventi dal Calendario (provato: l'annullamento .ics viene ignorato).
  // Per eliminare o spostare, l'app apre il Calendario sul giorno dell'evento e lo si cancella a mano.
  // per un appuntamento già eliminato il numero (2°, 3°…) non si può più calcolare
  const etichettaCal = (c, a) => (c.appuntamenti.includes(a) ? etichettaApp(c, a) : TIPO[a.tipo].nome);
  function scaricaIcs(c, a) {
    const [y, m, d] = a.data.split('-');
    const [hh, mm] = (a.ora || '09:00').split(':');
    const fine = new Date(+y, +m - 1, +d, +hh + 1, +mm);
    const f = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    const e = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, z => '\\' + z);
    const descr = [c.referente && `Referente: ${c.referente}`, c.telefono && `Tel: ${c.telefono}`, a.note].filter(Boolean).join('\n');
    const luogo = (c.indirizzoConsegna || c.indirizzoFatturazione || c.citta || '').replace(/\s*\n\s*/g, ', ');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FLPIT Clienti//IT', 'BEGIN:VEVENT',
      `UID:${a.id}@flpit-clienti`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${y}${m}${d}T${hh}${mm}00`, `DTEND:${f(fine)}`,
      `SUMMARY:${e(`FLPIT · ${etichettaCal(c, a)} · ${c.nomeLocale || ''}`)}`,
      luogo ? `LOCATION:${e(luogo)}` : '', descr ? `DESCRIPTION:${e(descr)}` : '', 'END:VEVENT', 'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
    a.inCalendario = true; tocca(c); salvaTutto();
    scarica(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), `FLPIT_${(c.nomeLocale || 'appuntamento').replace(/[^\w]+/g, '_')}.ics`);
  }

  // Link che apre il Calendario dell'iPhone su data e ora dell'appuntamento (secondi dal 1° gennaio 2001).
  function linkCalendario(a) {
    const [y, m, d] = a.data.split('-');
    const [hh, mm] = (a.ora || '09:00').split(':');
    return `calshow:${Math.round(new Date(+y, +m - 1, +d, +hh, +mm) / 1000) - 978307200}`;
  }

  // Dopo un'eliminazione (vecchi = appuntamenti tolti) o uno spostamento (nuovo = l'appuntamento con la nuova data).
  let perCalendario = null;
  function proponiCalendario(c, vecchi, nuovo) {
    vecchi = vecchi.filter(a => a.inCalendario && a.data);
    if (!vecchi.length) return;
    perCalendario = { c, nuovo };
    const riga = a => `<a class="riga" href="${linkCalendario(a)}">
        <span class="riga-testo"><span>Apri il Calendario · ${esc(giorno(a.data))}${a.ora ? ', ' + esc(a.ora) : ''}</span>
        <small>${esc(etichettaCal(c, a))} · cancella lì l'evento «FLPIT · …»</small></span>${CHEV}</a>`;
    apriFoglio(nuovo ? `
      <h4>Spostalo anche nel Calendario</h4>
      <p class="sottotitolo">${esc(nome(c))}</p>
      <h3 class="titolo-gruppo">1. Cancella l'evento vecchio</h3>
      <div class="gruppo">${riga(vecchi[0])}</div>
      <h3 class="titolo-gruppo">2. Aggiungi la nuova data</h3>
      <div class="gruppo"><button type="button" class="riga" data-azione="calendario-nuovo">
        <span class="riga-testo"><span>Aggiungi al Calendario · ${esc(giorno(nuovo.data))}${nuovo.ora ? ', ' + esc(nuovo.ora) : ''}</span></span>${CHEV}</button></div>
      <button type="button" class="btn-link centro-blocco" data-chiudi>Fatto</button>` : `
      <h4>Toglilo anche dal Calendario</h4>
      <p class="sottotitolo">${esc(nome(c))} · l'app non può cancellarlo da sola</p>
      <div class="gruppo">${vecchi.map(riga).join('')}</div>
      <p class="nota centro">Si apre il Calendario su quel giorno: tocca l'evento e «Elimina evento».</p>
      <button type="button" class="btn-link centro-blocco" data-chiudi>Fatto</button>`);
  }

  // ----- foglio generico -----
  function apriFoglio(html) { $('#foglio-contenuto').innerHTML = html; $('#foglio').hidden = false; }
  function chiudiFoglio() { $('#foglio').hidden = true; $('#foglio-contenuto').innerHTML = ''; }

  /* =====================================================================
     TESTI PER IL FORNITORE (in inglese; solo copia, nessun invio)
     ===================================================================== */
  const saluto = () => (imp.referente || '').trim() ? `Hi ${imp.referente.trim()},` : 'Hi,';
  const chiusura = () => (imp.firma || '').trim() ? `Thanks,\n${imp.firma.trim()}` : 'Thanks';
  function elenco(coppie) {
    return coppie.filter(([, v]) => (v || '').trim()).map(([k, v]) => `- ${k}: ${v.trim().replace(/\s*\n\s*/g, ', ')}`).join('\n');
  }
  function testoRegistrazione(c) {
    const contatto = [c.email, c.telefono].filter(Boolean).join(' / ');
    const mancanti = [['nome del locale', c.nomeLocale], ['città', c.citta], ['referente', c.referente], ['email o telefono', contatto]]
      .filter(([, v]) => !(v || '').trim()).map(([k]) => k);
    return { mancanti, testo: `${saluto()}\n\nI'd like to register a new venue under my name:\n${elenco([
      ['Venue name', c.nomeLocale], ['City', c.citta], ['Contact person', c.referente], ['Email / phone', contatto]
    ])}\n\nCould you please confirm the registration?\n\n${chiusura()}` };
  }
  function testoFattura(c) {
    const campi = [
      ['Registered company name', c.ragioneSociale, 'ragione sociale'], ['VAT number (Partita IVA)', c.partitaIva, 'Partita IVA'],
      ['Registered billing address', c.indirizzoFatturazione, 'sede legale'], ['Delivery address', c.indirizzoConsegna, 'indirizzo di consegna'],
      ['Delivery recipient', c.destinatarioConsegna, 'destinatario'], ['Best phone number for delivery', c.telefonoConsegna, 'telefono per la consegna'],
      ['Contact person', c.referente, 'referente'], ['Phone', c.telefono, 'telefono'], ['Email', c.email, 'email']
    ];
    const extra = [];
    if (c.bundle) extra.push(['Bundle', `${c.bundle} lamps`]);
    if (c.logo) extra.push(['Custom logo', c.logo === 'si' ? 'yes' : 'no']);
    return { mancanti: campi.filter(([, v]) => !(v || '').trim()).map(x => x[2]),
      testo: `${saluto()}\n\nHere are the details for the invoice for ${c.nomeLocale || 'the venue'}${c.citta ? ' (' + c.citta + ')' : ''}:\n${elenco(campi)}${
        extra.length ? '\n' + elenco(extra) : ''}\n\n${chiusura()}` };
  }
  async function copia(testo) {
    try { await navigator.clipboard.writeText(testo); return true; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = testo; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, testo.length);
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
      ta.remove(); return ok;
    }
  }
  async function copiaPerFornitore(gen) {
    const { testo, mancanti } = gen(corrente);
    if (mancanti.length && !confirm(`Mancano: ${mancanti.join(', ')}.\n\nCopiare comunque?`)) return;
    if (await copia(testo)) toast('Copiato: incollalo in WhatsApp e controllalo');
    else prompt('Copia questo testo:', testo);
  }

  /* =====================================================================
     EXPORT E BACKUP
     ===================================================================== */
  const nk = (g, v) => conRef(NOMI_F[g][v] || '');
  const COL_CLIENTI = [
    { t: 'Stato cliente', w: 18, v: c => nomeStato(c) },
    { t: 'Tappa raggiunta', w: 18, v: c => `${tappa(c)}. ${FASE[c.fase].nome}` },
    { t: 'Prossima azione', w: 34, v: c => { const p = prossimaCosa(c); return p ? p.testo : ''; } },
    { t: 'Nome locale', w: 26, v: c => c.nomeLocale }, { t: 'Città', w: 16, v: c => c.citta },
    { t: 'Referente', w: 20, v: c => c.referente }, { t: 'Telefono', w: 16, v: c => c.telefono, testo: true },
    { t: 'Email', w: 26, v: c => c.email }, { t: 'Ragione sociale', w: 28, v: c => c.ragioneSociale },
    { t: 'Partita IVA', w: 14, v: c => c.partitaIva, testo: true },
    { t: 'Sede legale / fatturazione', w: 34, v: c => c.indirizzoFatturazione },
    { t: 'Indirizzo consegna', w: 34, v: c => c.indirizzoConsegna }, { t: 'Destinatario consegna', w: 22, v: c => c.destinatarioConsegna },
    { t: 'Telefono consegna', w: 16, v: c => c.telefonoConsegna, testo: true },
    { t: 'Bundle (lampade)', w: 10, v: c => c.bundle }, { t: 'Logo', w: 8, v: c => ({ si: 'Sì', no: 'No' }[c.logo] || '') },
    { t: 'Note cliente', w: 40, v: c => c.note },
    { t: 'Primo contatto', w: 14, v: c => dataIt(primoContatto(c)) }, { t: 'Ultimo incontro', w: 14, v: c => dataIt(ultimoIncontro(c)) },
    { t: 'Prossimo appuntamento', w: 30, v: c => { const p = prossimoApp(c); return p ? `${dataIt(p.data)}${p.ora ? ' ' + p.ora : ''} · ${etichettaApp(c, p)}` : ''; } },
    { t: 'N. appuntamenti', w: 10, v: c => String(c.appuntamenti.length) },
    { t: '{F} · Registrazione', w: 16, v: c => nk('registrazione', c.fornitore.registrazione) },
    { t: '{F} · Reg. inviata il', w: 14, v: c => dataIt(c.fornitore.dataRegInviata) },
    { t: '{F} · Reg. confermata il', w: 14, v: c => dataIt(c.fornitore.dataRegConfermata) },
    { t: '{F} · Fattura', w: 20, v: c => nk('fattura', c.fornitore.fattura) },
    { t: '{F} · Dati inviati il', w: 14, v: c => dataIt(c.fornitore.dataDatiInviati) },
    { t: '{F} · Fattura ricevuta il', w: 14, v: c => dataIt(c.fornitore.dataFatturaRicevuta) },
    { t: '{F} · Mandata al cliente il', w: 14, v: c => dataIt(c.fornitore.dataFatturaInoltrata) },
    { t: '{F} · N. fattura', w: 14, v: c => c.fornitore.numeroFattura, testo: true },
    { t: '{F} · Commissione', w: 14, v: c => nk('commissione', c.fornitore.commissione) },
    { t: '{F} · Commissione pagata il', w: 14, v: c => dataIt(c.fornitore.dataCommPagata) },
    { t: '{F} · Note', w: 34, v: c => c.fornitore.note },
    { t: 'Creato il', w: 17, v: c => dataOraIt(c.creato) }, { t: 'Aggiornato il', w: 17, v: c => dataOraIt(c.aggiornato) },
    { t: 'ID', w: 14, v: c => c.id }
  ];
  const COL_APP = [
    { t: 'Data', w: 12, v: (c, a) => dataIt(a.data) }, { t: 'Ora', w: 8, v: (c, a) => a.ora },
    { t: 'Nome locale', w: 26, v: c => c.nomeLocale }, { t: 'Città', w: 16, v: c => c.citta },
    { t: 'Appuntamento', w: 16, v: (c, a) => etichettaApp(c, a) }, { t: 'Svolto', w: 8, v: (c, a) => (a.fatto ? 'Sì' : 'No') },
    { t: 'Note', w: 44, v: (c, a) => a.note }, { t: 'Referente', w: 20, v: c => c.referente },
    { t: 'Telefono', w: 16, v: c => c.telefono }, { t: 'Stato cliente', w: 18, v: c => nomeStato(c) }, { t: 'ID cliente', w: 14, v: c => c.id }
  ];
  const val = x => (x == null ? '' : String(x));
  const righeClienti = () => [...clienti].sort((a, b) => (a.creato || '').localeCompare(b.creato || '')).map(c => COL_CLIENTI.map(k => val(k.v(c))));
  function righeApp() {
    const r = [];
    clienti.forEach(c => c.appuntamenti.forEach(a => r.push({ c, a })));
    r.sort((x, y) => chiaveApp(x.a).localeCompare(chiaveApp(y.a)));
    return r.map(({ c, a }) => COL_APP.map(k => val(k.v(c, a))));
  }
  function csvCampo(v, col) {
    const s = String(v);
    if (col.testo && s) return `"=""${s.replace(/"/g, '""""')}"""`; // resta testo in Excel (zeri iniziali)
    if (/[";\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    if (/^[=+\-@]/.test(s)) return `"'${s.replace(/"/g, '""')}"`;
    return s;
  }
  function creaCsv() {
    const righe = [COL_CLIENTI.map(c => csvCampo(intestazione(c.t), {})).join(';'), ...righeClienti().map(r => r.map((v, i) => csvCampo(v, COL_CLIENTI[i])).join(';'))];
    return new Blob(['\uFEFF' + righe.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  }
  function creaXlsx() {
    return window.XLSX_MINI.buildXlsx([
      { name: 'Clienti', rows: [COL_CLIENTI.map(c => intestazione(c.t)), ...righeClienti()], widths: COL_CLIENTI.map(c => c.w) },
      { name: 'Appuntamenti', rows: [COL_APP.map(c => c.t), ...righeApp()], widths: COL_APP.map(c => c.w) }
    ]);
  }
  const creaBackup = () => new Blob([JSON.stringify({ app: 'FLPIT Clienti', versione: VERSIONE_DATI, esportato: new Date().toISOString(), impostazioni: imp, clienti, studio, studioProgressi: progressi }, null, 1)], { type: 'application/json' });

  function scarica(blob, nomeFile) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeFile;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function consegna(blob, nomeFile, diretto) {
    if (diretto) { scarica(blob, nomeFile); return true; }
    try {
      const file = new File([blob], nomeFile, { type: blob.type });
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return true;
      }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    scarica(blob, nomeFile);
    return true;
  }
  async function esporta(tipo, diretto) {
    if (!clienti.length) { toast('Nessun cliente da esportare'); return; }
    const d = new Date();
    const nomeFile = `FLPIT_clienti_${isoData(d)}_${pad(d.getHours())}${pad(d.getMinutes())}.${tipo}`;
    const blob = tipo === 'xlsx' ? creaXlsx() : tipo === 'csv' ? creaCsv() : creaBackup();
    if (await consegna(blob, nomeFile, diretto)) {
      try { localStorage.setItem(CHIAVE_EXPORT, new Date().toISOString()); } catch (e) {}
      toast(tipo === 'json' ? 'Backup salvato' : `Esportati ${clienti.length} clienti`);
      disegna();
    }
  }
  function importaBackup(testo) {
    let d;
    try { d = JSON.parse(testo); } catch (e) { throw new Error('il file non è un backup valido.'); }
    const arrivati = Array.isArray(d) ? migraV1(d)
      : d && Array.isArray(d.clienti) ? d.clienti.map(c => normalizza(JSON.parse(JSON.stringify(c))))
      : null;
    if (!arrivati) throw new Error('il file non contiene clienti.');
    // le impostazioni del backup si usano solo se su questo telefono mancano
    if (d && d.impostazioni && typeof d.impostazioni === 'object' && !CAMPI_IMP.some(k => imp[k])) {
      CAMPI_IMP.forEach(k => { if (d.impostazioni[k]) imp[k] = String(d.impostazioni[k]); });
      salvaImp(); applicaNomi();
    }
    // materiale di studio e progressi: il materiale solo se qui manca, i progressi si uniscono (vince il più recente)
    if (d && d.studio && !studio) { try { studio = validaStudio(d.studio); scriviJson(CHIAVE_STUDIO, studio); } catch (e) {} }
    if (d && d.studioProgressi && typeof d.studioProgressi === 'object') {
      Object.entries(d.studioProgressi).forEach(([k, v]) => { if (v && (!progressi[k] || (v.data || '') > (progressi[k].data || ''))) progressi[k] = v; });
      scriviJson(CHIAVE_PROG, progressi);
    }
    let aggiunti = 0, sostituiti = 0;
    arrivati.forEach(c => {
      const i = clienti.findIndex(x => x.id === c.id);
      if (i >= 0) { clienti[i] = c; sostituiti++; } else { clienti.push(c); aggiunti++; }
    });
    salvaTutto();
    return { aggiunti, sostituiti };
  }

  /* =====================================================================
     EVENTI
     ===================================================================== */
  $$('[data-vai]').forEach(b => b.addEventListener('click', () => vai(b.dataset.vai)));
  $$('[data-nuovo]').forEach(b => b.addEventListener('click', () => apriScheda(nuovoCliente(), true)));
  $('#cerca').addEventListener('input', disegnaClienti);
  $('#filtro-clienti').addEventListener('click', e => {
    const b = e.target.closest('[data-filtro]');
    if (b) { filtroClienti = b.dataset.filtro; disegnaClienti(); }
  });

  // Apertura di un cliente da qualsiasi lista; spunta in Agenda con conferma.
  $('#principale').addEventListener('click', e => {
    const sv = e.target.closest('[data-svolto]');
    if (sv) {
      const c = clienti.find(x => x.id === sv.dataset.cliente);
      const a = c && c.appuntamenti.find(x => x.id === sv.dataset.svolto);
      if (a && segnaSvolto(c, a)) {
        disegna();
        if (serveProssimo(c, a)) toast(`${nome(c)}: nessun altro appuntamento`, { testo: 'Fissa il prossimo', f: () => { apriScheda(c, false, 'appuntamenti'); apriFoglioApp(null, true); } });
      }
      return;
    }
    const ap = e.target.closest('[data-apri]');
    if (ap) { const c = clienti.find(x => x.id === ap.dataset.apri); if (c) apriScheda(c, false, ap.dataset.tabApri); return; }
    const va = e.target.closest('[data-vai-a]');
    if (va) vai(va.dataset.vaiA);
    const ex = e.target.closest('[data-esporta]');
    if (ex) esporta(ex.dataset.esporta, ex.hasAttribute('data-diretto'));
  });

  $('#btn-ripristina').addEventListener('click', () => $('#file-import').click());

  // Studio
  $('#btn-studio').addEventListener('click', apriFileStudio);
  $('#file-studio').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const n = importaStudio(await file.text());
      toast(`Materiale caricato: ${n} schede`);
      vai('studio');
    } catch (err) { alert('Caricamento non riuscito: ' + err.message); }
  });
  $('#studio').addEventListener('input', e => {
    if (e.target.id !== 'cerca-studio') return;
    cercaStudio = e.target.value;
    const pos = e.target.selectionStart;
    disegnaStudio();
    const c = $('#cerca-studio'); c.focus(); try { c.setSelectionRange(pos, pos); } catch (er) {}
  });
  $('#studio').addEventListener('click', e => {
    const ck = e.target.closest('[data-check]');
    if (ck) { const id = ck.dataset.check; if (checklist[id]) delete checklist[id]; else checklist[id] = true; scriviJson(CHIAVE_CHECK, checklist); disegnaStudio(); return; }
    const sg = e.target.closest('[data-studio-segna]');
    if (sg) {
      const id = sg.dataset.studioSegna;
      segnaScheda(id, imparata({ id }) ? null : 'imparata');
      const y = window.scrollY; disegnaStudio(); window.scrollTo(0, y);
      return;
    }
    const b = e.target.closest('[data-studio]');
    if (!b) return;
    const az = b.dataset.studio;
    if (az === 'carica') { apriFileStudio(); return; }
    if (az === 'home') vistaStudio = { tipo: 'home' };
    else if (az === 'argomento') vistaStudio = { tipo: 'argomento', id: b.dataset.arg };
    else if (az === 'ripasso') vistaStudio = { tipo: 'ripasso', arg: b.dataset.arg || '', coda: codaRipasso(b.dataset.arg || ''), i: 0, so: 0, no: 0, mostra: false };
    else if (az === 'mostra') vistaStudio.mostra = true;
    else if (az === 'risposta') {
      const v = vistaStudio;
      segnaScheda(v.coda[v.i], b.dataset.esito);
      if (b.dataset.esito === 'imparata') v.so++; else v.no++;
      v.i++; v.mostra = false;
    } else if (az === 'azzera') { checklist = {}; scriviJson(CHIAVE_CHECK, checklist); }
    disegnaStudio();
    if (az !== 'mostra' && az !== 'azzera') window.scrollTo(0, 0);
  });
  $('#file-import').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = importaBackup(await file.text());
      toast(`Ripristinati: ${r.aggiunti} nuovi, ${r.sostituiti} aggiornati`);
      disegna();
    } catch (err) { alert('Ripristino non riuscito: ' + err.message); }
  });

  // Scheda
  $('#btn-indietro').addEventListener('click', chiudiScheda);
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => mostraTab(b.dataset.tab)));
  $('#percorso').addEventListener('click', e => { const b = e.target.closest('[data-fase]'); if (b) impostaFase(b.dataset.fase); });
  $('#btn-ferma').addEventListener('click', apriFoglioFerma);

  // Salva senza ridisegnare la scheda: un tocco su un bottone mentre si esce da un campo non va perso.
  function salvaSenzaRidisegno() {
    tocca(corrente);
    if (!clienti.includes(corrente) && !vuoto(corrente)) clienti.push(corrente);
    if (clienti.includes(corrente) && salvaTutto()) {
      $('#salvataggio').textContent = 'Salvato';
      clearTimeout(timerSalvato);
      timerSalvato = setTimeout(() => { $('#salvataggio').textContent = ''; }, 1400);
    }
    $('#s-nome').textContent = corrente.nomeLocale || 'Nuovo cliente';
    $('#s-sotto').textContent = [corrente.citta, corrente.referente].filter(Boolean).join(' · ');
    $('#btn-elimina').hidden = !clienti.includes(corrente);
  }

  $('#form').addEventListener('input', e => {
    const el = e.target;
    if (!corrente || !el.name) return;
    scrivi(corrente, el.name, el.value);
    // mentre si scrive, un avviso già mostrato si aggiorna (così sparisce appena il dato è giusto)
    const em = $(`.avviso-campo[data-per="${el.name}"]`);
    if (em && em.textContent) avvisoCampo(el.name);
    if (el.name.startsWith('fornitore.data')) avvisiPassi();
    salvaSenzaRidisegno();
  });

  // Uscendo da un campo: correzione automatica (maiuscole, +39, spazi…) e avvisi.
  $('#form').addEventListener('change', e => {
    const el = e.target;
    if (!corrente || !el.name) return;
    const ctl = CONTROLLI[el.name];
    if (ctl && ctl.normalizza) {
      const v = ctl.normalizza(el.value, corrente);
      if (v !== el.value) { el.value = v; scrivi(corrente, el.name, v); }
    }
    salvaSenzaRidisegno();
    aggiornaAvvisi(); // solo testi degli avvisi: nessun bottone viene ricreato
  });

  $('#form').addEventListener('click', e => {
    const cr = e.target.closest('[data-correggi]');
    if (cr) {
      e.preventDefault();
      const el = $('#form')[cr.dataset.correggi];
      el.value = cr.dataset.valore; scrivi(corrente, el.name, el.value); salvaCorrente();
      return;
    }
    const rf = e.target.closest('#riepilogo-fattura');
    if (rf) { if (rf.dataset.vaiCampo) vaiAlCampo(rf.dataset.vaiCampo); return; }
    const sc = e.target.closest('.scelte[data-campo] button');
    if (sc) {
      const s = sc.closest('.scelte');
      const campo = s.dataset.campo;
      const v = leggi(corrente, campo) === sc.dataset.valore ? '' : sc.dataset.valore; // secondo tocco = deseleziona
      scrivi(corrente, campo, v); aggiornaScelte(s, v); salvaCorrente();
      return;
    }
    const sp = e.target.closest('[data-gruppo]');
    if (sp) { spuntaPasso(sp.dataset.gruppo, +sp.dataset.i); return; }
    const as = e.target.closest('[data-app-svolto]');
    if (as) {
      const a = corrente.appuntamenti.find(x => x.id === as.dataset.appSvolto);
      if (!a) return;
      if (a.fatto) { a.fatto = false; salvaCorrente(); }
      else if (segnaSvolto(corrente, a)) { salvaCorrente(); if (serveProssimo(corrente, a)) apriFoglioApp(null, true); }
      return;
    }
    const am = e.target.closest('[data-app-modifica]');
    if (am) { apriFoglioApp(corrente.appuntamenti.find(x => x.id === am.dataset.appModifica)); }
  });

  $('#btn-nuovo-app').addEventListener('click', () => apriFoglioApp(null));
  $('#btn-copia-sede').addEventListener('click', () => {
    const f = $('#form');
    f.indirizzoConsegna.value = corrente.indirizzoConsegna = corrente.indirizzoFatturazione || '';
    if (!f.destinatarioConsegna.value) f.destinatarioConsegna.value = corrente.destinatarioConsegna = corrente.ragioneSociale || corrente.nomeLocale || '';
    if (!f.telefonoConsegna.value) f.telefonoConsegna.value = corrente.telefonoConsegna = corrente.telefono || '';
    salvaCorrente();
  });
  $('#btn-copia-registrazione').addEventListener('click', () => copiaPerFornitore(testoRegistrazione));
  $('#btn-copia-fattura').addEventListener('click', () => copiaPerFornitore(testoFattura));
  $('#btn-elimina').addEventListener('click', () => {
    if (!confirm(`Eliminare «${nome(corrente)}» e i suoi appuntamenti? Non si può annullare.`)) return;
    clienti = clienti.filter(x => x !== corrente);
    salvaTutto();
    corrente = null; nuovo = false;
    chiudiScheda();
    toast('Cliente eliminato');
  });

  // Foglio dal basso
  $('#foglio').addEventListener('click', e => {
    if (e.target.closest('[data-chiudi]')) { chiudiFoglio(); return; }
    const es = e.target.closest('[data-esito]');
    if (es) { chiudiFoglio(); impostaEsito(es.dataset.esito); return; }
    const tp = e.target.closest('[data-tipo]');
    if (tp) { tipoScelto = tp.dataset.tipo; $$('#f-tipo button').forEach(b => b.setAttribute('aria-pressed', String(b === tp))); return; }
    if (e.target.closest('#f-fatto')) { fattoScelto = !fattoScelto; $('#f-fatto').setAttribute('aria-pressed', String(fattoScelto)); avvisoApp(); return; }
    const az = e.target.closest('[data-azione]');
    if (!az) return;
    if (az.dataset.azione === 'salva-app') salvaApp();
    else if (az.dataset.azione === 'ics') scaricaIcs(corrente, appInModifica);
    else if (az.dataset.azione === 'calendario-nuovo' && perCalendario) scaricaIcs(perCalendario.c, perCalendario.nuovo);
    else if (az.dataset.azione === 'elimina-app') {
      if (!confirm('Eliminare questo appuntamento?')) return;
      const tolto = appInModifica;
      corrente.appuntamenti = corrente.appuntamenti.filter(x => x !== tolto);
      chiudiFoglio(); salvaCorrente();
      proponiCalendario(corrente, [tolto]);
    }
  });

  $('#foglio').addEventListener('input', e => { if (e.target.id === 'f-data' || e.target.id === 'f-ora') avvisoApp(); });
  $('#foglio').addEventListener('change', e => { if (e.target.id === 'f-data' || e.target.id === 'f-ora') avvisoApp(); });

  // Impostazioni (pagina Dati): salvate solo su questo telefono.
  $('#impostazioni').addEventListener('input', e => {
    const el = e.target.closest('[data-imp]');
    if (!el) return;
    imp[el.dataset.imp] = el.value;
    salvaImp(); applicaNomi(); disegnaBadge();
  });
  $('#impostazioni').addEventListener('change', e => {
    const el = e.target.closest('[data-imp]');
    if (!el) return;
    imp[el.dataset.imp] = el.value = el.value.trim();
    salvaImp(); applicaNomi(); toast('Impostazione salvata');
  });

  $('#toast').addEventListener('click', e => {
    if (!e.target.closest('#toast-azione') || !azioneToast) return;
    const az = azioneToast;
    azioneToast = null; $('#toast').hidden = true;
    az.f();
  });

  applicaNomi();
  vai('dafare');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // Per i test automatici
  window.__flpit = { creaCsv, creaXlsx, creaBackup, importaBackup, migraV1, CONTROLLI, pivaValida, testoRegistrazione, testoFattura, importaStudio, formatta, codaRipasso, get clienti() { return clienti; }, get studio() { return studio; }, get progressi() { return progressi; } };
})();
