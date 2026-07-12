import { Link } from 'react-router-dom'

const FEATURES: { name: string; desc: string }[] = [
  {
    name: 'Šifrovaný trezor',
    desc: 'Vše se šifruje ve tvém prohlížeči (zero-knowledge). Obsah poznámek server nikdy nevidí — ani my.',
  },
  {
    name: 'Markdown s auto-nadpisem',
    desc: 'Piš v Markdownu; první nadpis „# …" se automaticky stane názvem poznámky. Název jde i přepsat ručně.',
  },
  {
    name: 'Preview',
    desc: 'Přepínej mezi psaním a náhledem vykresleného Markdownu přímo v editoru.',
  },
  {
    name: 'Rychlé uložení',
    desc: 'Ctrl+Enter (na Macu Cmd+Enter) uloží poznámku odkudkoli z editoru.',
  },
  {
    name: 'Chytré hledání',
    desc: 'Fulltext nad seznamem, který ignoruje diakritiku — „clanek" najde „Článek".',
  },
  {
    name: 'Vlastní URL poznámky',
    desc: 'Každá poznámka má svou adresu (/notes/…), takže se na ni dá odkázat i vrátit.',
  },
  {
    name: 'Zachytávání odkazu',
    desc: 'Napiš do adresy „tato-doména/" a rovnou za to celou URL — vytvoří se z ní nová poznámka.',
  },
  {
    name: 'Odemykání otiskem',
    desc: 'Na zařízeních s biometrikou odemkneš trezor otiskem nebo obličejem, bez psaní hesla.',
  },
  {
    name: 'Offline a jako appka',
    desc: 'Poznámky si přečteš i bez signálu a bpad jde nainstalovat na plochu jako samostatnou aplikaci (PWA).',
  },
  {
    name: 'Recovery kód',
    desc: 'Při registraci dostaneš jednorázový kód, kterým obnovíš přístup, když zapomeneš heslo. Ulož si ho.',
  },
  {
    name: 'Ověření e-mailu',
    desc: 'Neověřený účet má strop na počet poznámek; po ověření e-mailu píšeš bez omezení.',
  },
]

export default function Features() {
  return (
    <div className="detail-page">
      <Link to="/account" className="back-link">← zpět</Link>

      <div className="account-card">
        <h2 className="account-title">Co bpad umí</h2>
        <ul className="feature-list">
          {FEATURES.map((f) => (
            <li className="feature-item" key={f.name}>
              <div className="feature-name">{f.name}</div>
              <div className="feature-desc">{f.desc}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
