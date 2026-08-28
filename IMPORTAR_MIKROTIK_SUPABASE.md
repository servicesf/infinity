# Importar clientes MikroTik a Supabase

El importador lee clientes de un MikroTik y los guarda en Supabase para el panel
WISP y el portal Mi servicio.

La importacion no corta, activa ni modifica clientes en MikroTik. Solo consulta
PPPoE Secrets o Simple Queues, segun `IMPORT_SOURCE`.

## Regla importante: un router por ejecucion

No pongas varios bloques `MIKROTIK_HOST`, `ROUTER_CODE` o `ROUTER_NAME` dentro
del mismo `.env.import`. Node solo usara un valor por variable y los bloques
pueden mezclarse.

Guarda una configuracion separada para cada router:

```text
.env.import.rb4011
.env.import.rb750
.env.import.e50ug
```

Antes de importar, copia solamente el archivo del router que vas a leer:

```bash
cp .env.import.e50ug .env.import
```

En Windows PowerShell:

```powershell
Copy-Item .env.import.e50ug .env.import -Force
```

## Variables comunes

Cada archivo comienza con:

```env
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY

MIKROTIK_PORT=8728
MIKROTIK_USER=USUARIO_API_DEL_ROUTER
MIKROTIK_PASSWORD=CLAVE_API_DEL_ROUTER
MIKROTIK_TLS=false

IMPORT_SET_INITIAL_DAYS=false
IMPORT_INITIAL_DAYS=30
IMPORT_INITIAL_HOURS=3
```

No publiques estos archivos ni compartas capturas donde aparezcan las claves.

## RB4011 Fibra con PPPoE

Ejemplo de `.env.import.rb4011`:

```env
MIKROTIK_HOST=10.100.100.2
ROUTER_CODE=rb4011-fibra
ROUTER_NAME=RB4011 Fibra
ROUTER_KIND=fibra
IMPORT_SOURCE=pppoe
```

En este router heredado, la contrasena PPPoE puede usarse como CI si contiene
solamente numeros. El portal nunca muestra la contrasena.

## RB750 Inalambrico con Simple Queues

Ejemplo de `.env.import.rb750`:

```env
MIKROTIK_HOST=10.100.100.3
ROUTER_CODE=rb750-inalambrico
ROUTER_NAME=RB750 Inalambrico
ROUTER_KIND=inalambrico
IMPORT_SOURCE=queues
```

En queues, el nombre identifica al cliente y el target identifica su IP.

## CORE-E50UG Caihuasi con PPPoE y RADIUS

Ejemplo de `.env.import.e50ug`:

```env
MIKROTIK_HOST=10.100.100.4
ROUTER_CODE=core-e50ug-caihuasi
ROUTER_NAME=CORE-E50UG Caihuasi
ROUTER_KIND=inalambrico
IMPORT_SOURCE=pppoe
IMPORT_RADIUS_MANAGED_ACCOUNTS=core-e50ug-caihuasi:prueba
```

En routers inalambricos, la contrasena PPPoE no se usa como carnet. Si el
cliente no tiene CI registrado, el panel muestra `sin CI`.

`IMPORT_RADIUS_MANAGED_ACCOUNTS` evita que una importacion de lectura cambie el
estado o vencimiento administrado por RADIUS.

## Probar sin guardar

Selecciona primero el archivo del router y ejecuta:

```bash
node tools/import-mikrotik-to-supabase.js --dry-run
```

Para revisar solamente un usuario de prueba:

```bash
node tools/import-mikrotik-to-supabase.js --dry-run --only=prueba
```

Para contar las cuentas que existen en el MikroTik pero todavia no aparecen en
Supabase, sin modificar ningun registro:

```bash
node tools/import-mikrotik-to-supabase.js --dry-run --missing-only
```

## Importar

Cuando el resultado de prueba sea correcto:

```bash
node tools/import-mikrotik-to-supabase.js
```

Para importar solamente el usuario de prueba:

```bash
node tools/import-mikrotik-to-supabase.js --only=prueba
```

Para agregar unicamente las cuentas faltantes y conservar sin cambios los
clientes, fechas y estados existentes:

```bash
node tools/import-mikrotik-to-supabase.js --missing-only
```

Para comparar los planes guardados con los perfiles actuales del MikroTik sin
cambiar pagos, vencimientos, estados ni sesiones:

```bash
node tools/import-mikrotik-to-supabase.js --dry-run --sync-plans-only
```

Despues de revisar el resultado, sincroniza solamente el nombre del plan y su
mensualidad:

```bash
node tools/import-mikrotik-to-supabase.js --sync-plans-only
```

El importador identifica cada registro por:

- `router_id + pppoe_user` en PPPoE.
- `router_id + queue_name` en Simple Queues.

Por eso dos routers pueden tener un usuario llamado `prueba` sin compartir CI,
plan, vencimiento ni historial.

## Verificacion

Despues de importar:

1. Abre el panel y busca el nombre del cliente.
2. Comprueba el campo Router.
3. Comprueba PPPoE o Queue/IP.
4. Si no existe CI real, debe decir `sin CI`.
5. No uses una contrasena PPPoE como CI en routers nuevos.
