
---

## 6. Catálogo de alimentos (`/food`) y despensa

El front ya usa `GET /food/products`, `GET /food/products/:id` y `POST /food/recipes/generate` (+ `GET /food/recipes/:id`): búsqueda mientras se escribe en «Añadir ingrediente», ficha del producto y generador de recetas desde la despensa.

| Mejora | Por qué | Hoy el front |
| --- | --- | --- |
| Guardar `foodId` (opcional) en los ítems de la despensa | Al añadir desde el catálogo se pierde el vínculo: no se pueden calcular macros de la despensa ni mandar `foodId` al generar recetas | Guarda solo nombre, cantidad y unidad (gramos de la porción elegida) |
| `category` en la despensa (o derivarla de `foodGroups`) | Los filtros «Proteínas / Lácteos / Granos…» del diseño | Clasifica por palabras clave en el navegador |
| Unidades con conversión a gramos (taza, u…) | `generate` solo recibe `grams`; ítems en «u» o «taza» van sin cantidad | Solo envía `grams` cuando la unidad es g o kg |
| `GET /food/history` en el front | Ya existe en el back (recetas generadas y comidas registradas) | No se muestra todavía |
| Publicar el módulo en `main` | En el remoto, `main` sigue en `d2d4f17` sin `/food`; el código está en `dev` | — |
