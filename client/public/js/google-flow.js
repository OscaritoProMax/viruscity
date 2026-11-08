// Interpretación PURA de las respuestas de POST /auth/google (sin red ni DOM; se prueba con node:test).
//
// interpretGoogleResponse(status, body) → uno de:
//   { kind: "success", token, username }   200 con token y username
//   { kind: "need_username" }              409 username_required (primer login con Google)
//   { kind: "username_taken" }             409 username_taken
//   { kind: "invalid_token" }              401 invalid_id_token
//   { kind: "email_not_verified" }         401 email_not_verified
//   { kind: "bad_request", message }       400 (p. ej. username con formato inválido)
//   { kind: "server_error" }               cualquier otra cosa (incluido un body que no es objeto)

const isText = (value) => typeof value === "string" && value !== "";

export function interpretGoogleResponse(status, body) {
    const data = body !== null && typeof body === "object" && !Array.isArray(body) ? body : null;
    const error = data?.error;

    if (status === 200 && data && isText(data.token) && isText(data.username)) {
        return { kind: "success", token: data.token, username: data.username };
    }
    if (status === 409 && error === "username_required") return { kind: "need_username" };
    if (status === 409 && error === "username_taken") return { kind: "username_taken" };
    if (status === 401 && error === "invalid_id_token") return { kind: "invalid_token" };
    if (status === 401 && error === "email_not_verified") return { kind: "email_not_verified" };
    if (status === 400) {
        return { kind: "bad_request", message: isText(error) ? error : "La solicitud no es válida." };
    }
    return { kind: "server_error" };
}
