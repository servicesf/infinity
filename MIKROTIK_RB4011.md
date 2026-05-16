# Conexion segura con MikroTik RB4011

Este proyecto ya tiene un puente local en `bridge/server.js`.

La idea es:

1. El panel admin se abre desde tu red local.
2. El puente local recibe los botones `Cortar`, `Activar` y `Recargar`.
3. El puente se conecta al RB4011 por API.
4. El MikroTik ejecuta acciones sobre PPPoE y queues.

No abras tu MikroTik directo a internet para esto.

## 1. Crear usuario API en MikroTik

En la terminal de MikroTik:

```routeros
/user group add name=wisp-api policy=read,write,api
/user add name=api_wisp group=wisp-api password=CAMBIA_ESTA_CLAVE
/ip service enable api
/ip service set api port=8728
```

Si quieres permitir solo una PC local:

```routeros
/ip service set api address=192.168.88.0/24
```

Cambia `192.168.88.0/24` por tu red real.

## 2. Configurar el puente

Copia:

```powershell
Copy-Item bridge\.env.example bridge\.env
```

Edita `bridge\.env`:

```env
MIKROTIK_HOST=172.16.20.1
MIKROTIK_PORT=8728
MIKROTIK_USER=api_wisp
MIKROTIK_PASSWORD=TU_CLAVE_REAL
MIKROTIK_TLS=false
BRIDGE_PORT=8787
```

## 3. Encender el panel local

Desde la carpeta del proyecto:

```powershell
node bridge\server.js
```

Abre:

```text
http://localhost:8787/admin.html
```

Desde ahi usa `Cortar`, `Activar` y `Recargar`.

## 4. Como corta

Para un cliente con usuario PPPoE `juan.perez`, el puente hace:

```routeros
/ppp secret disable [find name="juan.perez"]
/ppp active remove [find name="juan.perez"]
/queue simple disable [find name="juan.perez"]
```

Para activar:

```routeros
/ppp secret enable [find name="juan.perez"]
/queue simple enable [find name="juan.perez"]
```

El nombre PPPoE y el nombre de queue deben estar bien llenados en el panel.

## Segun tu export actual

Tu PPPoE esta en:

```routeros
/interface pppoe-server server
add disabled=no interface=vlan100 one-session-per-host=yes service-name=vlan100
```

Tu gateway PPPoE/local es:

```routeros
172.16.20.1
```

Por eso el `.env` queda recomendado asi:

```env
MIKROTIK_HOST=172.16.20.1
MIKROTIK_PORT=8728
```

Si la PC donde corre el bridge esta conectada por otra red de administracion y llega al router por `192.168.8.1`, puedes usar:

```env
MIKROTIK_HOST=192.168.8.1
```

El panel tiene boton **Sincronizar MikroTik**. Ese boton lee `/ppp secret` y trae tus usuarios PPPoE reales al panel.
