/**
 * Sestaví z definice ovládání (akce -> seznam kláves) vyhledávací mapu
 * token (malými písmeny) -> akce.
 */
export function buildKeyMap(controls) {
    const map = {};
    for (const [action, keys] of Object.entries(controls)) {
        for (const k of keys) {
            map[k.toLowerCase()] = action;
        }
    }
    return map;
}

// Vrátí akci pro klávesovou událost (porovnává proti key i code, case-insensitive)
export function actionForEvent(map, e) {
    return map[e.key.toLowerCase()] ?? map[e.code.toLowerCase()];
}
