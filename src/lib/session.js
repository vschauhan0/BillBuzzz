const KEY = "billbuzz_session"

export function saveSession(token, user) {
  const data = { token, user }
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}

export function getToken() {
  return getSession()?.token || null
}

export function clearSession() {
  localStorage.removeItem(KEY)
}
