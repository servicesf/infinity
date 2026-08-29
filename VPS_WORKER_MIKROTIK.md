# Worker VPS para cortes automaticos

Este worker corre en la VPS y conecta Supabase con tus MikroTik por WireGuard.

Por seguridad empieza en `WORKER_DRY_RUN=true`: solo muestra lo que haria, no corta y no cambia estados en Supabase.

## Archivo `.env.worker`

```env
SUPABASE_URL=https://ajtvajugpwzvfjwcxlmm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SB_SECRET

MIKROTIK_USER=api_wisp
MIKROTIK_PASSWORD=CLAVE_API_CON_WRITE

WORKER_DRY_RUN=true
WORKER_INTERVAL_MS=30000
WORKER_ONLY_PPPOE=
WORKER_SYNC_WINBOX_RECHARGES=false
WORKER_SYNC_WINBOX_CUTS=false
WORKER_RECHARGE_DAYS=30
WORKER_RECHARGE_HOURS=3
WORKER_QUEUE_CUT_LIMIT=10k/10k
```

El usuario `api_wisp` debe tener permiso `read,write,api`, porque este worker si ejecutara cortes y activaciones cuando lo activemos.

## Probar sin cortar

```bash
node tools/vps-worker.js
```

Debe mostrar acciones en modo `[DRY_RUN]`.
En este modo no deshabilita PPPoE y tampoco marca clientes como cortados.

## Activar cortes reales

Solo despues de probar con un usuario PPPoE de prueba:

```env
WORKER_DRY_RUN=false
WORKER_ONLY_PPPOE=prueba
```

Luego reinicias el worker.

Cuando confirmes que corta solo `prueba`, quitas `WORKER_ONLY_PPPOE` para produccion.

## Como corta automaticamente

1. En el panel programas fecha y hora de corte.
2. Esa fecha se guarda en `customers.paid_until`.
3. El worker revisa clientes vencidos con `auto_cut_enabled=true`.
4. Cuando llega la fecha, ejecuta en MikroTik:
   - en PPPoE deshabilita el secreto y elimina la sesion activa
   - en Simple Queues guarda la velocidad original y reduce el cliente a `10k/10k`
5. Marca el cliente como `cortado` en Supabase.

Los clientes sin fecha no se cortan.

Cuando recargas un cliente de Simple Queues, el worker restaura exactamente el
limite que guardo antes del corte, por ejemplo `15M/50M`. Tambien reconoce el
limite anterior `64k/64k` para recuperar cortes hechos con versiones previas.

## Recargas hechas desde WinBox

Si quieres que al habilitar un PPPoE en WinBox el panel lo tome como recarga de 30 dias + 3 horas:

```env
WORKER_SYNC_WINBOX_RECHARGES=true
WORKER_RECHARGE_DAYS=30
WORKER_RECHARGE_HOURS=3
```

Regla:

- Si en el panel esta `cortado` o `vencido`
- y en MikroTik el PPPoE aparece habilitado
- entonces el worker registra pago metodo `winbox`
- y pone vencimiento `ahora + 30 dias + 3 horas`

Para alinear cortes hechos en WinBox:

```env
WORKER_SYNC_WINBOX_CUTS=true
```

## Prueba controlada con FreeRADIUS

Para administrar por RADIUS solo una cuenta de un router concreto:

```env
RADIUS_MANAGED_ACCOUNTS=10.100.100.4:prueba
RADIUS_AUTHORIZE_FILE=/etc/freeradius/3.0/mods-config/files/authorize
RADIUS_USERS_JSON={"prueba":{"password":"CLAVE_DEL_CLIENTE_DE_PRUEBA","group":"plan 50","rateLimit":"10M/25M"}}
```

La cuenta se identifica por `IP_DEL_ROUTER:usuario`. Esto evita afectar a un
usuario con el mismo nombre en otro MikroTik.

- `Recargar` escribe una autorización para el usuario y recarga FreeRADIUS.
- `Cortar` escribe un rechazo RADIUS y elimina la sesión PPP activa.
- El secreto PPP local puede permanecer deshabilitado: RADIUS es quien autentica.
- La sincronización WinBox se omite para esa cuenta porque un secreto local
  deshabilitado es normal cuando RADIUS tiene el control.
