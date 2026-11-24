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

**Estado en el backend:** con tests, el `PUT` acepta jpeg, png, webp y heic, responde a CORS y `publicUrl()` usa el mismo dominio. Falta definir `PUBLIC_BASE_URL` en el `.env` del servidor.

## 3. Nuevo en el backend

- Las tarjetas y el detalle de receta traen `nutritionEstimated: boolean`: `true` si los macros los estimó un modelo. Conviene mostrarlo («≈ 620 kcal»).
- Las recetas de la biblioteca no cruzan ingredientes con el catálogo: su `pantryMatch` suele ser `0/N`, mejor no mostrarlo cuando `nutritionEstimated` es `true`.

## 4. Mise en place y Explorar

- **Ingredientes por paso:** `GET /recipes/{id}` trae `steps[].ingredients` (`ingredientId, label, prep, quantity, inPantry`), y `steps[].ingredients` de la sesión de cocina ahora viene lleno en todas las recetas (la pantalla de cocina ya lo pinta en «Para este paso»). Puede venir `[]` si el paso no usa nada nuevo.
- **Editor de recetas (opcional):** `PATCH /me/recipes/{id}` acepta `steps[].ingredientIds`. Sin eso, el backend lo deduce del texto.
- **Explorar:** `GET /me/recommendations` sin `slot`, `usingIngredientIds` ni `source=pantry` devuelve el recetario completo: comunidad, Noshy y biblioteca intercaladas, sin filtrar por el tiempo preferido (solo `maxMinutes` si se manda). `reason.label` dice «De la comunidad» o «Recetario».

## 5. Foto de tu plato

- `GET /me/cooked-recipes` trae `photoUrl` (la foto más reciente del usuario, o `null`). `recipe.imageUrl` ya viene con esa foto cuando existe; igual en `mostCooked` de Inicio. La receta en sí no cambia de portada.
