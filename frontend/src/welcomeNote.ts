// Obsah uvítací poznámky, kterou dostane nový účet po registraci. Učí funkce
// používáním. `host` se vkládá dynamicky, ať příklad se zachytáváním odkazu
// sedí ať je appka kdekoli nasazená. První `#` nadpis se stane názvem.
export function welcomeNoteMarkdown(host: string): string {
  return `# 👋 Vítej v bpad

Tohle je tvoje první poznámka — klidně ji uprav nebo smaž. **bpad** je šifrovaný zápisník: obsah vidíš jen ty, server ho nikdy nevidí.

## Zkus si to
- **Markdown** — první nadpis \`# …\` se stane názvem poznámky. Nahoře přepni na **Preview**.
- **Rychlé uložení** — \`Ctrl+Enter\` (na Macu \`Cmd+Enter\`) uloží odkudkoli z editoru.
- **Hledání** — nad seznamem; funguje i bez diakritiky (\`clanek\` najde „Článek").
- **Odkazy** se otevírají v nové kartě: [bpad.pro](https://bpad.pro)
- **Checklist**:
  - [x] Založit účet
  - [ ] Uložit si recovery kód
  - [ ] Nainstalovat bpad jako appku

## Ulož odkaz jedním tahem
Do adresního řádku napiš \`${host}/\` a rovnou za to celou URL:

\`${host}/https://example.com\`

…a vytvoří se z ní nová poznámka.

## Soukromí
- Heslo ani klíče **neopouštějí prohlížeč**. Bez hesla i recovery kódu se k obsahu nedostane nikdo — ani my.
- Zapni si **odemykání otiskem**, pokud to zařízení umí.
- Funguje i **offline** (čtení) a jde nainstalovat jako appka.

Celý přehled najdeš v **Účet → Co bpad umí**.
`
}
