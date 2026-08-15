import {Theme} from "../theme.js";

/**
 * Levely bez tématu – temná obloha s mřížkou, prosté bloky, rudé hroty
 * a synthwave. Je to podoba, kterou hra měla od začátku, a zároveň výchozí
 * chování `Theme`, takže tady nezbývá než říct, že žádné jméno nemá.
 *
 * I „žádné téma“ je jedno z prostředí a ve hře se střídá s ostatními
 * (levely 1, 8 a 15) – nemá to být jen náhradní řešení pro chybějící téma.
 */
export class Default extends Theme
{
    name() {
        return null;
    }
}
