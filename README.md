# Noshy Backend

API HTTP de Noshy para el MVP web. Está construida con Node.js, TypeScript, Express 5 y Zod.

## Desarrollo

Desde `backend/`:

```bash
pnpm install
pnpm dev
```

Comprobaciones:

```bash
pnpm test
pnpm build
```

El estado actual usa adaptadores en memoria para poder validar los contratos. La persistencia, Redis, perfiles y `preferences.md` real se integrarán en otra unidad de trabajo.

## Configuración

Variables opcionales:

| Variable | Valor por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP entre 1 y 65535 |
| `CORS_ORIGIN` | `*` | Origen permitido por CORS |
| `JSON_BODY_LIMIT` | `1mb` | Límite de cuerpos JSON, por ejemplo `512kb` o `2mb` |

La configuración se valida al iniciar mediante `src/infrastructure/config/env.ts`.

## Autenticación

Los endpoints protegidos usan:

```http
Authorization: Bearer <token>
```

El MVP actual usa tokens temporales en memoria. No es un mecanismo de producción.

## Contratos principales

| Área | Operaciones |
| --- | --- |
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Plan nutricional | `POST /plans`, `GET /plans`, `GET /plans/active`, `PUT /plans/active` |
| Inventario | `POST/GET /inventory/items`, `PATCH/DELETE /inventory/items/:id` |
| Recetas propias | `POST/GET /recipes`, `PATCH/DELETE /recipes/:id`, publicar y retirar publicación |
| Comunidad | `GET /community/recipes`, `GET /community/recipes/:id` |
| Agente chef | sesiones, contexto, mensajes y `POST /chef/sessions/:id/respond` |
| Feedback | `POST/GET /feedback`, `GET /recommendations` |
| Compras | `POST /shopping-list` desde recetas guardadas o recetas inline del agente |

Los errores de rutas desconocidas y JSON inválido usan el formato:

```json
{
	"error": {
		"code": "ROUTE_NOT_FOUND",
		"message": "Ruta no encontrada."
	}
}
```

## Flujo MVP

```text
Plan nutricional + preferencias
	-> sesión del agente chef
	-> receta adaptada al inventario
	-> lista de compras
	-> feedback comportamental
	-> comunidad de recetas públicas
```

## Workflow Git

Cada feature se crea desde el `dev` remoto actualizado, se implementa y valida en su propia rama, se publica en el remoto y finalmente se fusiona a `dev`.

El frontend, la persistencia real, Redis, el event bus y el proveedor de IA están fuera del alcance de este submódulo en la etapa actual.
