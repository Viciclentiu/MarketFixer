export async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Nu putem contacta serverul. Verifică conexiunea și încearcă din nou.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.error || `Cererea a eșuat (${response.status}).`);
  if (data === null) throw new Error("Serverul a trimis un răspuns invalid.");
  return data;
}

export const scanPath = (id) => `/scans/${encodeURIComponent(id)}`;
