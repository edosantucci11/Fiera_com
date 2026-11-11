window.SCHEDA_SCHEMA = {
  "versione": 3,
  "nota": "Unica fonte dei campi della scheda: la usano l'app e il gestionale. Dopo il segno = deve restare JSON valido (niente commenti). Ricavata dalla scheda CONTATTI cartacea. Opzioni dei campi: 'stile' ('priorita' = colore di priorita' sulle schede, 'livello' = indicatore a tacche; la prima opzione e' la piu' alta), 'obbligatorio', 'dipendeDa' (mostra il campo solo se un altro campo ha un certo valore), 'filtro' (filtro nel gestionale), 'colonna' (colonna nell'elenco del gestionale), 'nota' (campo di note facoltativo in fondo alla sezione: non conta nella completezza della scheda). Il nome 'sp' e' un nome interno senza spazi: non cambiarlo.",
  "titoloScheda": ["azienda", "nome"],
  "sezioni": [
    {
      "id": "contatto",
      "titolo": "Contatto",
      "scansioneQr": true,
      "campi": [
        {"id": "nome", "etichetta": "Nome e cognome", "tipo": "testo", "obbligatorio": true, "sp": "ContattoNome"},
        {"id": "azienda", "etichetta": "Azienda", "tipo": "testo", "obbligatorio": true, "sp": "Azienda"},
        {"id": "ruolo", "etichetta": "Ruolo", "tipo": "testo", "sp": "Ruolo"},
        {"id": "paese", "etichetta": "Paese", "tipo": "testo", "sp": "Paese"},
        {"id": "email", "etichetta": "Email", "tipo": "email", "sp": "Email"},
        {"id": "telefono", "etichetta": "Telefono", "tipo": "telefono", "sp": "Telefono"},
        {"id": "note_contatto", "etichetta": "Note", "tipo": "testolungo", "nota": true, "sp": "NoteContatto"}
      ]
    },
    {
      "id": "incontro",
      "titolo": "Incontro",
      "campi": [
        {"id": "modalita", "etichetta": "Modalità", "tipo": "scelta", "filtro": true, "opzioni": ["On line", "Evento", "In fabbrica"], "sp": "Modalita"},
        {"id": "note_incontro", "etichetta": "Note", "tipo": "testolungo", "nota": true, "sp": "NoteIncontro"}
      ]
    },
    {
      "id": "prodotti",
      "titolo": "Prodotti",
      "campi": [
        {"id": "nostra_fabbricazione", "inEvidenza": true, "etichetta": "Nostra fabbricazione", "tipo": "sceltamultipla", "filtro": true, "opzioni": ["Suture", "Knotless", "Emostatico", "Biologico", "Reti sintetiche", "Fissatori", "Sylarum", "Superseton", "Altri/Assut brand"], "sp": "NostraFabbricazione"},
        {"id": "altri_prodotti", "inEvidenza": true, "etichetta": "Altri prodotti", "tipo": "sceltamultipla", "opzioni": ["Prodotto distribuzione", "Prodotto altri partner", "Altro"], "sp": "AltriProdotti"},
        {"id": "altri_prodotti_altro", "etichetta": "Altro (specificare)", "tipo": "testo", "dipendeDa": {"campo": "altri_prodotti", "valore": "Altro"}, "sp": "AltriProdottiAltro"},
        {"id": "note_prodotti", "etichetta": "Note", "tipo": "testolungo", "nota": true, "sp": "NoteProdotti"}
      ]
    },
    {
      "id": "identificazione",
      "titolo": "Identificazione",
      "campi": [
        {"id": "identificazione", "etichetta": "Identificazione", "tipo": "sceltamultipla", "filtro": true, "colonna": true, "opzioni": ["Potenziale cliente", "Fornitore", "Qualità/Regolatorio", "Progetto", "Contatto già noto"], "sp": "Identificazione"},
        {"id": "esperienza", "etichetta": "Esperienza con il prodotto", "tipo": "scelta", "opzioni": ["Conosce bene / competenze mediche", "Conosce bene / competenze imprenditoriali, commerciali", "Non esperienza / campo nuovo", "Altre competenze"], "sp": "EsperienzaProdotto"},
        {"id": "conoscenza_assut", "etichetta": "Conoscenza Assut", "tipo": "scelta", "opzioni": ["Conosce Assut", "Assut come fabbricante/Progetti o altri marchi", "Mai conosciuto"], "sp": "ConoscenzaAssut"},
        {"id": "interesse", "etichetta": "Livello di interesse e motivazione", "tipo": "scelta", "filtro": true, "colonna": true, "stile": "livello", "opzioni": ["Interesse forte e concreto", "Interessato / curioso", "Poco interessato"], "sp": "Interesse"},
        {"id": "concorrenza", "etichetta": "Conoscenza della concorrenza", "tipo": "scelta", "opzioni": ["Buona conoscenza", "Conoscenza parziale", "Non conosce"], "sp": "ConoscenzaConcorrenza"},
        {"id": "note_identificazione", "etichetta": "Note", "tipo": "testolungo", "nota": true, "sp": "NoteIdentificazione"}
      ]
    },
    {
      "id": "presentazione",
      "titolo": "Presentazione prodotto",
      "campi": [
        {"id": "presentazione", "etichetta": "Presentazione prodotto", "tipo": "sceltamultipla", "opzioni": ["Introduzione generale", "Spiegazione dettagliata", "Cataloghi / materiali", "QR code scaricato"], "sp": "PresentazioneProdotto"},
        {"id": "note_presentazione", "etichetta": "Note", "tipo": "testolungo", "nota": true, "sp": "NotePresentazione"}
      ]
    },
    {
      "id": "campioni",
      "titolo": "Campioni e test",
      "campi": [
        {"id": "consegna_campioni", "etichetta": "Consegna campioni", "tipo": "scelta", "opzioni": ["Generale", "A richiesta"], "sp": "ConsegnaCampioni"},
        {"id": "consegna_campioni_dettaglio", "etichetta": "A richiesta (dettaglio)", "tipo": "testo", "dipendeDa": {"campo": "consegna_campioni", "valore": "A richiesta"}, "sp": "ConsegnaCampioniDettaglio"},
        {"id": "richiesta_campioni", "inEvidenza": true, "etichetta": "Richiesta campioni", "tipo": "scelta", "opzioni": ["Generale", "Specifici"], "sp": "RichiestaCampioni"},
        {"id": "richiesta_campioni_dettaglio", "etichetta": "Specifici (dettaglio)", "tipo": "testo", "dipendeDa": {"campo": "richiesta_campioni", "valore": "Specifici"}, "sp": "RichiestaCampioniDettaglio"},
        {"id": "note_campioni", "etichetta": "Note", "tipo": "testolungo", "nota": true, "sp": "NoteCampioni"}
      ]
    },
    {
      "id": "prezzi",
      "titolo": "Prezzi",
      "campi": [
        {"id": "prezzi", "etichetta": "Prezzi", "tipo": "sceltamultipla", "opzioni": ["Abbiamo dato prezzi", "Fornisce prezzi concorrenza", "Chiede sconti"], "sp": "Prezzi"},
        {"id": "prezzi_dati", "etichetta": "Prezzi dati", "tipo": "testolungo", "dipendeDa": {"campo": "prezzi", "valore": "Abbiamo dato prezzi"}, "sp": "PrezziDati"},
        {"id": "prezzi_concorrenza", "etichetta": "Prezzi della concorrenza", "tipo": "testolungo", "dipendeDa": {"campo": "prezzi", "valore": "Fornisce prezzi concorrenza"}, "sp": "PrezziConcorrenza"},
        {"id": "sconto_richiesto", "etichetta": "Sconto richiesto", "tipo": "testolungo", "dipendeDa": {"campo": "prezzi", "valore": "Chiede sconti"}, "sp": "ScontoRichiesto"},
        {"id": "note_prezzi", "etichetta": "Note", "tipo": "testolungo", "nota": true, "sp": "NotePrezzi"}
      ]
    },
    {
      "id": "registrazioni",
      "titolo": "Registrazioni",
      "campi": [
        {"id": "registrazioni_conoscenza", "etichetta": "Conoscenza", "tipo": "scelta", "opzioni": ["Ottima conoscenza / ufficio interno", "Buona conoscenza / agenzia esterna", "Conoscenza superficiale", "Nessuna conoscenza"], "sp": "RegConoscenza"},
        {"id": "registrazioni_informazioni", "etichetta": "Informazioni sulle registrazioni", "tipo": "scelta", "opzioni": ["Complesse / lunghe", "Semplici / rapide", "Non ha esperienza"], "sp": "RegInformazioni"},
        {"id": "registrazioni_aspetti", "etichetta": "Aspetti registrazione", "tipo": "sceltamultipla", "opzioni": ["Assut proprietario", "Importatore obbligatorio", "Possibilità importazione pre-registrazione", "Etichettatura dedicata", "Visita ispettiva prevista"], "sp": "RegAspetti"},
        {"id": "tempo_stimato", "etichetta": "Tempo stimato", "tipo": "scelta", "filtro": true, "opzioni": ["Più di un anno", "Entro 1 anno", "Pochi mesi"], "sp": "TempoStimato"},
        {"id": "note_registrazioni", "etichetta": "Note", "tipo": "testolungo", "nota": true, "sp": "NoteRegistrazioni"}
      ]
    },
    {
      "id": "note",
      "titolo": "Note",
      "campi": [
        {"id": "note_generali", "etichetta": "Note generali", "tipo": "testolungo", "sp": "NoteGenerali"}
      ]
    },
    {
      "id": "giudizio",
      "titolo": "Giudizio – Export Dept",
      "campi": [
        {"id": "giudizio_nome", "etichetta": "Nome", "tipo": "testo", "sp": "GiudizioNome"},
        {"id": "giudizio", "etichetta": "Giudizio", "tipo": "scelta", "filtro": true, "colonna": true, "stile": "priorita", "opzioni": ["A – Ottimo / alto potenziale", "B – Buono / interessante", "C – Sufficiente", "D – Scarso"], "sp": "Giudizio"},
        {"id": "nota_finale", "etichetta": "Nota finale", "tipo": "testolungo", "sp": "NotaFinale"}
      ]
    },
    {
      "id": "followup",
      "titolo": "Follow-up",
      "campi": [
        {"id": "azione_followup", "etichetta": "Azione di follow-up", "tipo": "testolungo", "sp": "AzioneFollowUp"}
      ]
    }
  ]
};
