# Importar clientes MikroTik a Supabase

Este importador lee clientes PPPoE del MikroTik y los guarda en Supabase para el portal **Mi servicio**.

No corta, no activa y no modifica clientes en MikroTik. Solo usa comandos de lectura.

## 1. Usuario seguro en MikroTik

En WinBox > New Terminal del RB4011:

```routeros
/user group add name=wisp-sync policy=read,api,sensitive
/user add name=sync_supabase group=wisp-sync password="CAMBIA_ESTA_CLAVE_LARGA"
```

Si ya existe:

```routeros
/user group set [find name=wisp-sync] policy=read,api,sensitive
/user set [find name=sync_supabase] group=wisp-sync password="CAMBIA_ESTA_CLAVE_LARGA"
```

El permiso `sensitive` es necesario porque el carnet esta guardado como password PPPoE.

## 2. Crear `.env.import`

En la carpeta del proyecto crea un archivo `.env.import`:

```env
SUPABASE_URL=https://ajtvajugpwzvfjwcxlmm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PEGA_TU_SB_SECRET_AQUI

MIKROTIK_HOST=10.100.100.2
MIKROTIK_PORT=8728
MIKROTIK_USER=sync_supabase
MIKROTIK_PASSWORD=CLAVE_DEL_USUARIO_SYNC
MIKROTIK_TLS=false

ROUTER_CODE=rb4011-fibra
ROUTER_NAME=RB4011 Fibra
ROUTER_KIND=fibra

IMPORT_SET_INITIAL_DAYS=false
IMPORT_INITIAL_DAYS=30
```

Para el RB750 cambia:

```env
MIKROTIK_HOST=IP_DEL_RB750_POR_WIREGUARD
ROUTER_CODE=rb750-inalambrico
ROUTER_NAME=RB750 Inalambrico
ROUTER_KIND=inalambrico
```

## 3. Probar sin guardar

```powershell
node tools\import-mikrotik-to-supabase.js --dry-run
```

Debe mostrar cantidad de PPPoE encontrados, activos y cortados.

## 4. Importar a Supabase

```powershell
node tools\import-mikrotik-to-supabase.js
```

Despues puedes probar un cliente en:

```text
https://infinitbo.vercel.app/api/customer?ci=CARNET_DEL_CLIENTE
```

## 5. Seguridad

Cuando termines la importacion puedes desactivar el usuario temporal:

```routeros
/user disable sync_supabase
```

No compartas capturas donde se vea la columna `Password`.
