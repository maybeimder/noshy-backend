# Recomendaciones del front para el backend

Cosas que el front necesita del API `/api/v1` y que hoy no puede resolver por su cuenta. Probado contra producción con una sesión real.

## 1. Catálogo de ingredientes al añadir a la despensa (`/api/v1`, 23 nov 2026)

Probado con una sesión real: `GET /catalog/ingredients/search` responde bien (200 y el formato del contrato), pero el catálogo es corto y hay búsquedas comunes que no devuelven nada.

| Búsqueda | Resultado hoy |
| --- | --- |
| arroz, pollo, tomate, leche, huevo, avena, granola, yogur, banano | Encuentra |
| cereal, manzana, pan | Sin resultados |

| Mejora | Por qué | Hoy el front |
| --- | --- | --- |
| Ampliar el catálogo (frutas, panadería, cereales de desayuno, enlatados, snacks) y sus sinónimos en `searchText` («pan» → pan tajado / pan francés, «cereal» → hojuelas de maíz) | Si no está en el catálogo, el usuario no puede añadirlo: `POST /me/pantry/items` exige `ingredientId` | Dice «todavía no está en el catálogo» y sugiere otro nombre |
| Ingrediente de texto libre: `POST /me/pantry/items` con `{ text }` cuando no hay `ingredientId`, como `customExclusions` del onboarding | Mientras el catálogo crece, el usuario podría guardarlo igual | No hay forma de añadirlo |
| `GET /catalog/ingredients/{id}/products?storeId=` → `{ id, label, brand, packLabel, price }[]` | `POST /me/pantry/items` ya acepta `productId`, pero ningún endpoint lista los productos de un ingrediente, así que el front no puede mostrar «Pecorino · Pomona 150 g» al añadir | Añade solo el ingrediente, sin producto ni marca |

---

## 2. Subida de fotos en producción (23 nov 2026)

Probado con una sesión real: `POST /api/v1/media/uploads` responde 201, pero la `uploadUrl` firmada apunta a `http://localhost:3000/api/v1/storage/upload?...`. El navegador intenta subir la foto a la máquina del usuario y falla con «Failed to fetch». No se puede subir ninguna foto: portada de receta, «Sube tu versión» al terminar de cocinar ni avatar.

- **Causa:** `PUBLIC_BASE_URL` no está definida en el servidor, y `providers.factory.ts` la usa para firmar (`${PUBLIC_BASE_URL}/api/v1`).
- **Arreglo:** definir `PUBLIC_BASE_URL=https://api.noshy.javila.dev` en el `.env` del despliegue y reiniciar la API.
- **Verificar después:** que `PUT /api/v1/storage/upload` acepte el cuerpo binario con `Content-Type: image/jpeg|png|webp|heic` (parser de Fastify) y responda a la consulta CORS desde el dominio del front; y que `publicUrl()` devuelva el mismo dominio, porque si no las fotos subidas tampoco se verán.
