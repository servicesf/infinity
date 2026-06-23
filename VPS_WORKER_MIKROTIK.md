# Worker VPS para cortes automaticos

Este worker corre en la VPS y conecta Supabase con tus MikroTik por WireGuard.

Por seguridad empieza en `WORKER_DRY_RUN=true`: solo muestra lo que haria, no corta.

## Archivo `.env.worker`

```env
SUPABASE_URL=https://ajtvajugpwzvfjwcxlmm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SB_SECRET

MIKROTIK_USER=api_wisp
MIKROTIK_PASSWORD=CLAVE_API_CON_WRITE

WORKER_DRY_RUN=true
WORKER_INTERVAL_MS=30000
```

El usuario `api_wisp` debe tener permiso `read,write,api`, porque este worker si ejecutara cortes y activaciones cuando lo activemos.

## Probar sin cortar

```bash
node tools/vps-worker.js
```

Debe mostrar acciones en modo `[DRY_RUN]`.

## Activar cortes reales

Solo despues de probar con un usuario PPPoE de prueba:

```env
WORKER_DRY_RUN=false
```

Luego reinicias el worker.

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
