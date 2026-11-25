// Verificación del ID token de Google (Google Identity Services, opción A).
//
// makeGoogleVerifier(client, clientId) → async (idToken) => payload
//   - client es un OAuth2Client de google-auth-library (en las pruebas, uno falso).
//   - Llama a client.verifyIdToken({ idToken, audience: clientId }) y devuelve ticket.getPayload().
//   - Defensa en profundidad: además comprueba que payload.aud sea exactamente clientId.
// No registra nada: los mensajes de error de la librería pueden incluir el token.

// Un ID token es un JWT: tres segmentos base64url separados por puntos.
// Se descarta antes de llamar a la librería, que primero descarga los certificados de Google
// (petición de red) y solo después revisa el formato del token.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function makeGoogleVerifier(client, clientId) {
    return async function verifyGoogle(idToken) {
        if (typeof idToken !== "string" || !JWT_SHAPE.test(idToken)) {
            throw new Error("ID token con formato inválido");
        }

        const ticket = await client.verifyIdToken({ idToken, audience: clientId });
        const payload = ticket.getPayload();

        if (!payload || payload.aud !== clientId) {
            throw new Error("audience del ID token incorrecto");
        }
        return payload;
    };
}

module.exports = { makeGoogleVerifier };
