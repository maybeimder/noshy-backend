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

**Estado en el backend:**

- **Catálogo:** la búsqueda sale de `products_slim` (Mongo, ~7.6k alimentos) más sinónimos («palta» → aguacate, «cereal» → hojuelas de maíz).
- **Texto libre:** `POST /me/pantry/items` con `{ text, quantity?, storage? }` (2–60 caracteres, sin `ingredientId`). Responde el mismo `PantryItem`, con `ingredientId: "txt_…"`. Unidades: `unit, g, kg, ml, l, cup, tbsp, tsp`. Si el texto es exactamente el nombre de un ingrediente base («arroz»), usa ese.
- **Productos:** `GET /catalog/ingredients/{ingredientId}/products?storeId=` → `{ id, label, brand, packLabel, price }[]`, con `price: { amount, currency } | null`. Los `food_…` y `txt_…` devuelven `[]`.

## 2. Subida de fotos en producción (23 nov 2026)

Probado con una sesión real: `POST /api/v1/media/uploads` responde 201, pero la `uploadUrl` firmada apunta a `http://localhost:3000/api/v1/storage/upload?...`. El navegador intenta subir la foto a la máquina del usuario y falla con «Failed to fetch». No se puede subir ninguna foto: portada de receta, «Sube tu versión» al terminar de cocinar ni avatar.

- **Causa:** `PUBLIC_BASE_URL` no está definida en el servidor, y `providers.factory.ts` la usa para firmar (`${PUBLIC_BASE_URL}/api/v1`).
- **Arreglo:** definir `PUBLIC_BASE_URL=https://api.noshy.javila.dev` en el `.env` del despliegue y reiniciar la API.
- **Verificar después:** que `PUT /api/v1/storage/upload` acepte el cuerpo binario con `Content-Type: image/jpeg|png|webp|heic` (parser de Fastify) y responda a la consulta CORS desde el dominio del front; y que `publicUrl()` devuelva el mismo dominio, porque si no las fotos subidas tampoco se verán.

**Estado en el backend:** con tests, el `PUT` acepta jpeg, png, webp y heic, responde a CORS y `publicUrl()` usa el mismo dominio. `PUBLIC_BASE_URL` ya está definida en el servidor (24 nov 2026: `/docs/json` anuncia `https://api.noshy.javila.dev`); si vuelve a apuntar a localhost en producción, la API lo avisa en el log al arrancar.

## 3. Nuevo en el backend

- Las tarjetas y el detalle de receta traen `nutritionEstimated: boolean`: `true` si los macros son estimados. Conviene mostrarlo («≈ 620 kcal»).
- Las recetas de la biblioteca no cruzan ingredientes con el catálogo: su `pantryMatch` suele ser `0/N`, mejor no mostrarlo cuando `nutritionEstimated` es `true`.

## 4. Mise en place y Explorar

- **Ingredientes por paso:** `GET /recipes/{id}` trae `steps[].ingredients` (`ingredientId, label, prep, quantity, inPantry`), y `steps[].ingredients` de la sesión de cocina ahora viene lleno en todas las recetas (la pantalla de cocina ya lo pinta en «Para este paso»). Puede venir `[]` si el paso no usa nada nuevo.
- **Editor de recetas (opcional):** `PATCH /me/recipes/{id}` acepta `steps[].ingredientIds`. Sin eso, el backend lo deduce del texto.
- **Explorar:** `GET /me/recommendations` sin `slot`, `usingIngredientIds` ni `source=pantry` devuelve el recetario completo: comunidad, Noshy y biblioteca intercaladas, sin filtrar por el tiempo preferido (solo `maxMinutes` si se manda). `reason.label` dice «De la comunidad» o «Biblioteca» (en el front, «Recetario» son las recetas propias y guardadas).

## 5. Foto de tu plato

- `GET /me/cooked-recipes` trae `photoUrl` (la foto más reciente del usuario, o `null`). `recipe.imageUrl` ya viene con esa foto cuando existe; igual en `mostCooked` de Inicio. La receta en sí no cambia de portada.

## 6. Explorar: recetario

- Las recetas del recetario vienen **en inglés** (título, ingredientes y pasos), con calorías estimadas.
- `source=library` devuelve solo el recetario. `meta.total` es el número de recetas y `meta.library` = `{ count, status }`: `filling` (trayendo más: volver a pedir), `paused` (no encontró más por ahora), `ready`.
- El front ya lo usa: chip «Biblioteca», etiqueta de origen y `≈ kcal` cuando `nutritionEstimated`.

## 7. Foto de los productos

- `GET /catalog/ingredients/search` trae `imageUrl: string | null`. El front ya la muestra en el desplegable y, si no hay o no carga, pone el pictograma sobre el degradado de marca.

## 8. Fotos de referencia y recetas del chef

- **Fotos:** `recipes_raw` no trae fotos. Las recetas sin foto propia ahora traen en `imageUrl` la de un plato parecido (`/api/v1/dishes/*.webp`, banco propio CC0) y `imageIsReference: true`; el detalle ya muestra «Foto de referencia». Si no se reconoce el plato, `imageUrl` sigue en `null`. Lo que publica un usuario sin foto no se toca.
- **Chef:** inventa su propia receta. El modelo la entrega en JSON, el backend la valida, revisa alergias y dieta, y llega como un bloque `recipeCard` normal (`reason.label: "Creada para ti"`, `id: "rcp_ai_…"`). Se abre con `GET /recipes/{id}`, y se puede guardar, cocinar y mandar a la lista.
- Son **privadas**: otra persona recibe 404, así que el enlace de compartir no le sirve a nadie más. `author.type` es `chef`.
- Puede tardar hasta 90 s en el peor caso (modelos gratis); el SSE manda latidos cada 10 s.

## 9. Huecos del MVP (24 nov 2026)

El front ya usa todo esto. Requiere la migración `0004_content_reports`.

- **Guardadas:** `GET /me/saved-recipes` (paginado). El front ya no guarda los ids en el dispositivo.
- **Compartir:** `GET /shared/recipes/{key}` es público; el enlace es `/r/{id}`.
- **Menú:** una semana nueva se abre sola al pedir `GET /me/menus/current`. `POST /me/menus/{id}/regenerate` cambia las recetas de hoy en adelante.
- **Compras y despensa:** se puede borrar un producto o una receta de la lista y cambiar cantidades. `PATCH /me/pantry/{id}` acepta `quantity`.
- **Recetas propias:** `unpublish`, `DELETE` y `rejectionReason` en la lista.
- **Comunidad:** perfil de creador, `q` y `authorId` en el feed, filtro `following`, borrar comentarios y `POST /community/reports`. Los reportes se guardan en `content_reports`; no hay panel para revisarlos.
- **Historial:** `GET /me/days?from&to` (máximo 31 días) y `entries` en cada día.
- **Cuenta:** `POST /auth/logout`, `POST /me/password`. Google y Apple aparecen en el front con `VITE_GOOGLE_CLIENT_ID` y `VITE_APPLE_CLIENT_ID`, los mismos ids de `GOOGLE_CLIENT_IDS` y `APPLE_CLIENT_IDS`.
- **Fuera del MVP:** correo (y con él, recuperar contraseña) y facturas (`RECEIPT_PARSER=none`; en el front, `shared/config/features.ts`).
