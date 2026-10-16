// Avviso "chiave di sviluppo": serve solo se le functions usano una chiave
// Gemini del tier GRATUITO, che usa i prompt per l'addestramento — in quel caso
// nessun testo reale del libro va mandato all'AI. Con il provider predefinito
// (Amazon Nova su Bedrock) i prompt non vengono usati per l'addestramento, quindi
// l'avviso è spento. Mettere true se si usa una chiave Gemini gratuita.
// La costante è condivisa da tutte le superfici che invocano l'AI (tab Sinossi,
// editor/rifinitura).
export const SHOW_FREE_TIER_WARNING = false;
