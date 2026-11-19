const key = "learnerToken";

export function saveLearnerToken(token: string): void {
  localStorage.setItem(key, token);
  sessionStorage.removeItem(key);
}

export function clearLearnerToken(): void {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

export function readLearnerToken(): string {
  const token = localStorage.getItem(key) || sessionStorage.getItem(key) || "";
  if (token) saveLearnerToken(token);
  return token;
}
