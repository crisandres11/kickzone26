# Servidor de KZ 26 (baneos, expulsiones, regalos y Discord)

Una página de GitHub no puede guardar baneos ni esconder una clave, así que esto corre en un
**Cloudflare Worker** gratuito. El Worker guarda los datos y es el único que conoce la clave de
admin y el webhook de Discord. **Ninguno de los dos va dentro de los archivos del juego.**

## Pasos (una sola vez)

1. Crea una cuenta gratis en cloudflare.com e instala Node.js.
2. En esta carpeta (`worker/`) ejecuta:
   ```
   npx wrangler login
   npx wrangler kv namespace create KZ
   ```
   Copia el `id` que muestra y pégalo en `wrangler.toml` (donde dice `PEGA_AQUI_EL_ID_DEL_KV`).
3. Guarda los secretos (te los pide por teclado, no quedan en ningún archivo):
   ```
   npx wrangler secret put ADMIN_KEY
   npx wrangler secret put DISCORD_WEBHOOK
   ```
4. Publica:
   ```
   npx wrangler deploy
   ```
   Te devuelve una dirección tipo `https://kz26-api.tuusuario.workers.dev`.
5. Pega esa dirección en `assets/kz26-config.js` (`window.KZ_API_URL = '...'`) y sube el cambio al repositorio.
6. (Recomendado) En `wrangler.toml` cambia `ALLOWED_ORIGIN` por la dirección de tu página, por ejemplo
   `https://tuusuario.github.io`, y vuelve a ejecutar `npx wrangler deploy`.

El panel queda en `/admin/` de tu sitio. Entra con la clave que guardaste en `ADMIN_KEY`.

## Importante sobre seguridad

- **Cambia el webhook de Discord.** Lo pegaste en un chat, así que ya no es secreto: en Discord ve a
  Ajustes del canal > Integraciones > Webhooks, borra ese y crea uno nuevo para el paso 3.
- Una clave de 6 dígitos se puede adivinar. El servidor bloquea la IP 15 minutos tras 8 intentos fallidos,
  pero conviene una clave más larga (por ejemplo 12 caracteres con letras y números).
- Los baneos y expulsiones los aplica el código del juego en el navegador del jugador. Frenan a la gran
  mayoría, pero alguien con conocimientos puede saltárselos. Para un juego entre amigos o una comunidad es suficiente.
- El juego identifica a cada jugador solo por su ID de 8 dígitos guardado en su navegador.
