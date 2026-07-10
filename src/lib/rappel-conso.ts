// Public French product-recall API (RappelConso). No key required.
export type RecallInfo = {
  reason: string;
  risk: string;
  date: string;
  url: string;
};

export async function checkRecallByBarcode(barcode: string): Promise<RecallInfo[]> {
  if (!barcode) return [];
  try {
    const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso0/records?where=gtins%20like%20%22%25${encodeURIComponent(barcode)}%25%22&limit=5&order_by=date_de_publication%20desc`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const rows = (data?.results ?? []) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      reason: String(r.motif_du_rappel ?? r.sous_categorie_de_produit ?? "Rappel produit"),
      risk: String(r.risques_encourus_par_le_consommateur ?? ""),
      date: String(r.date_de_publication ?? ""),
      url: String(r.lien_vers_affichette_pdf ?? r.lien_vers_la_fiche_rappel ?? ""),
    }));
  } catch {
    return [];
  }
}
