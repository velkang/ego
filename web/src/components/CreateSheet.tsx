import { ChevronRight, MapPinned, Ticket, Trophy, X } from "lucide-react";
import { Modal } from "./Modal";
import { Link } from "./Link";
const options = [
  {
    href: "/hide",
    icon: MapPinned,
    title: "Create money drops",
    sub: "Place USDC drops for people to find",
  },
  {
    href: "/pay",
    icon: Trophy,
    title: "Pay winners",
    sub: "Fund prizes that winners claim with their email",
  },
  {
    href: "/create",
    icon: Ticket,
    title: "Codes, event QR codes and puzzles",
    sub: "Giveaways with a code, a scan or an answer",
  },
];
export function CreateSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal titleId="create-title" className="create-sheet" onClose={onClose}>
      <span className="sheet-handle" aria-hidden="true" />
      <header className="sheet-heading">
        <h2 id="create-title">Create</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close Create"
          autoFocus
        >
          <X size={20} />
        </button>
      </header>
      <p className="help-text">Choose how people collect your USDC.</p>
      <div className="list-card">
        {options.map(({ href, icon: Icon, title, sub }) => (
          <Link key={href} href={href} className="list-row" onClick={onClose}>
            <span className="row-icon">
              <Icon size={19} />
            </span>
            <span className="row-main">
              <strong>{title}</strong>
              <span>{sub}</span>
            </span>
            <span className="row-end">
              <ChevronRight size={18} />
            </span>
          </Link>
        ))}
      </div>
    </Modal>
  );
}
