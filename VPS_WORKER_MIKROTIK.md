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
WORKER_RECHARGE_HOURS=6
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
   - deshabilita `/ppp secret`
   - elimina `/ppp active`
   - deshabilita `/queue simple` si existe
5. Marca el cliente como `cortado` en Supabase.

Los clientes sin fecha no se cortan.

## Recargas hechas desde WinBox

Si quieres que al habilitar un PPPoE en WinBox el panel lo tome como recarga de 30 dias + 6 horas:

```env
WORKER_SYNC_WINBOX_RECHARGES=true
WORKER_RECHARGE_DAYS=30
WORKER_RECHARGE_HOURS=6
```

Regla:

- Si en el panel esta `cortado` o `vencido`
- y en MikroTik el PPPoE aparece habilitado
- entonces el worker registra pago metodo `winbox`
- y pone vencimiento `ahora + 30 dias + 6 horas`

Para alinear cortes hechos en WinBox:

```env
WORKER_SYNC_WINBOX_CUTS=true
```
