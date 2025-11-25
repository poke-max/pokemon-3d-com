## Triple Battle UI (React + Vite)

Interfaz web minima para visualizar combates 3 vs 3 usando el motor de Pokemon Showdown vendorizado. La app se sirve con Vite y expone endpoints locales (`/api/simulate` y `/api/manual/*`) que ejecutan `TripleBattleComponent` y devuelven el snapshot + log para renderizar en el navegador.

### Requisitos previos

```bash
cd apps/triple-battle-ui
npm install
```

El simulador, los datos y el `TripleBattleComponent` estan en `vendor/pokemon-showdown`, por lo que no hace falta compilar ni referenciar el monorepo padre.

### Ejecutar en modo desarrollo

```bash
npm run dev
```

Abre la URL que Vite indica (por defecto `http://localhost:5173`). Cada vez que uses **Simular batalla 3 vs 3** el front-end hara `POST /api/simulate`; el middleware en `vite.config.ts` corre la batalla y responde con el resultado en JSON.

### Combate manual

1. Configura ambos equipos en el constructor (especie, objeto, habilidad, movimientos, naturaleza, genero, nivel, EVs/IVs).
2. Presiona **Iniciar batalla manual**. Esto crea una sesion persistente: tu controlas al Jugador 1 y el rival usa un bot aleatorio.
3. En la tarjeta **Acciones** se muestran los movimientos y cambios disponibles segun el `request` que emite el simulador. Envialos y el rival respondera automaticamente.
4. El Battle Log se actualiza cada turno con las lineas `|move|`, `|damage|`, `|win|`, etc. Cuando aparezca `|win|` la sesion termina y puedes iniciar otra con los equipos que quieras.

### Elegir los Pokemon de cada lado

Sobre el boton de simulacion veras dos tarjetas (Equipo Azul y Equipo Carmesi) con tres slots por Pokemon. Cada slot permite elegir especie, objeto, habilidad, cuatro movimientos, naturaleza, genero, nivel, EVs e IVs mediante dropdowns con buscador y campos numericos. Al cambiar la especie se autocompletan valores por defecto usando el Dex de la Gen 9, pero puedes editarlos; el payload se arma con el formato `gen9customgame`.

### Personalizar equipos desde la UI

El cuerpo del `POST /api/simulate` acepta el mismo shape que `TripleBattleComponent.simulate`. La UI ya envia equipos completos generados a partir de tus selecciones, pero si quisieras agregar mas campos basta con extender `App.tsx` y el middleware los reenviara al simulador.

### Construccion estatica

`npm run build` genera los assets de la UI. Recuerda que los endpoints `/api/simulate` y `/api/manual/*` estan implementados como middleware del dev server; para un despliegue real necesitaras alojar el front-end y exponer un backend (Express/Fastify/etc.) que invoque `TripleBattleComponent` del mismo modo que hace `vite.config.ts`.
