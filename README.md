# Relevo de Mr.RoBoT (Render)

Mando a distancia para usar **Mis Carteras / Mr.RoBoT** desde cualquier navegador o móvil.

- **No guarda datos.** Render gratis no conserva el disco, y no hace falta: los datos, las IAs y los permisos viven en la app del PC.
- **Funciona sin abrir puertos.** La app del PC se conecta hacia el relevo y recoge las peticiones con una espera de 25 s.
- **La app se identifica firmando.** Cada llamada va firmada con Ed25519. Aquí solo está la llave **pública**.
- **Los navegadores se vinculan con un código.** Es de 8 cifras y de un solo uso, y lo saca la app desde la bandeja o desde el menú Cuentas. Cada navegador guarda su propia llave en una cookie segura, y se puede revocar desde la app.
- **Lo que no se puede hacer desde fuera:**
  - operar;
  - tocar claves;
  - borrar robots;
  - reiniciarlos todos.

## Variables de entorno en Render

| Variable | Valor |
|---|---|
| `MR_LLAVE_PUBLICA` | La llave pública de la app (`GET /remoto` del puente → `llave_publica`). No es secreta. |

## Arranque

`npm start`. Sin dependencias. Comprobación: `GET /salud`.
