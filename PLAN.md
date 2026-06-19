# Plan de Cambio: Actualización del Sistema de Puntos

## Resumen Ejecutivo

Cambio del sistema de puntuación de la quiniela del Mundial 2026. Se pasa de un sistema basado en puntos (15/10-variable/0) a un sistema de miles de pesos colombianos (3k/2k/1k) para facilitar la lectura y comprensión del ranking.

## Sistema Actual vs. Nuevo

| Escenario | Sistema Actual | Sistema Nuevo |
|-----------|---------------|---------------|
| Marcador exacto | 15 puntos | 3k (3000 COP) |
| Ganador correcto (no exacto) | 10 - diferencia (máx 10, mín 0) | 2k (2000 COP) |
| Empate correcto (no exacto) | 10 - diferencia (máx 10, mín 0) | 1k (1000 COP) |
| Resultado incorrecto | 0 puntos | 0 |

## Impacto en la Base de Datos

Todos los valores actuales de `points` en `predictions/{uid}/{gameId}/points` y `score` en `users/{uid}/score` deben ser actualizados. No hay cambio de schema, solo cambio de valores.

## Archivos a Modificar

### 1. Backend (Firebase Functions)
- **`functions/src/index.ts`**: `calculatePoints()` — cambiar lógica de cálculo de 15/10-variable/0 a 3000/2000/1000/0.

### 2. Frontend (Web App)
- **`web/src/routes/Rules.tsx`**: Actualizar textos descriptivos, ejemplos numéricos y fórmulas.
- **`web/src/components/features/MatchCard.tsx`**: Actualizar condición de emoji `🥳` (antes `=== 15`, ahora `=== 3000`).
- **`utils/migrate.js`**: Sincronizar la función `calculatePoints()` para que recálculos futuros usen el nuevo sistema.

### 3. Scripts de Migración (Nuevos)
- **`utils/update-points.js`**: Script para actualizar todos los puntos existentes en la BD según la nueva tabla de conversión.
- **`utils/rollback-points.js`**: Script para revertir todos los puntos de la BD a los valores originales.

## Plan de Conversión de Datos

### Mapeo de valores

| Valor Antiguo | Valor Nuevo | Caso |
|---------------|-------------|------|
| 15 | 3000 | Marcador exacto |
| 10-14 | 2000 | Ganador correcto |
| 6-9 | 1000 | Empate correcto (o ganador con mucha diferencia) |
| 0-5 | 0 | Resultado incorrecto o sin puntos |

### Fórmula de conversión

Dado que la lógica antigua era:
- Exacto: 15
- Ganador correcto: `10 - (|homePred-homeActual| + |awayPred-awayActual|)`
- Mínimo: 0

La conversión a la nueva lógica simplificada es:
- Si `oldPoints === 15` → `3000` (exacto)
- Si `oldPoints > 0 && oldPoints < 15` → necesitamos saber si era ganador o empate
  - Se puede inferir de la predicción y el resultado real del partido
  - Si `getWinner(actual) === getWinner(prediction)`:
    - Si `getWinner(actual) === 'tied'` → `1000` (empate)
    - Si `getWinner(actual) !== 'tied'` → `2000` (ganador)
- Si `oldPoints === 0` → `0`

## Plan de Implementación (Rollback-friendly)

### Fase 1: Preparación
1. Crear branch `feature/update-system-points` ✅
2. Implementar cambios en código (backend, frontend, scripts)
3. Code review y aprobación

### Fase 2: Despliegue de Backend
1. Deploy `functions/src/index.ts` con la nueva lógica
2. Verificar que `updatePredictionPoints` y `updateUserScore` Cloud Functions usen los nuevos valores

### Fase 3: Migración de Datos
1. Ejecutar `node utils/update-points.js`
2. Verificar puntajes en Firebase Console
3. Ejecutar `node utils/rollback-points.js` en staging para validar que el rollback funciona

### Fase 4: Despliegue de Frontend
1. Build y deploy de `web/` con las nuevas reglas y emojis
2. Verificar visualización en Rules, MatchCards, Leaderboard, Podium

### Fase 5: Rollback (si es necesario)
1. Ejecutar `node utils/rollback-points.js` para restaurar puntos originales
2. Deploy de la versión anterior del backend
3. Re-deploy de la versión anterior del frontend

## Riesgos y Mitigación

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Pérdida de datos durante migración | Alto | Backup de la BD antes de ejecutar; rollback script probado |
| Inconsistencia entre frontend y backend | Medio | Desplegar backend primero, luego frontend |
| Usuarios confundidos por cambio de formato | Medio | Actualizar Rules.tsx para clarificar el sistema nuevo |
| Cloud Functions con lógica antigua en ejecución | Medio | Desplegar funciones antes de migrar datos |

## Checklist de Aprobación

- [ ] Plan revisado y aprobado
- [ ] Código de backend modificado y revisado
- [ ] Código de frontend modificado y revisado
- [ ] Scripts de migración y rollback creados y probados
- [ ] Deploy de backend exitoso
- [ ] Migración de datos ejecutada sin errores
- [ ] Deploy de frontend exitoso
- [ ] Verificación manual en la app
- [ ] Rollback validado (opcional)
