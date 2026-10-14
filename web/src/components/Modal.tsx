import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  children,
  titleId,
  className = "",
  onClose,
}: {
  children: ReactNode;
  titleId: string;
  className?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const scroll = document.querySelector<HTMLElement>(".phone-scroll");
    const overflow = scroll?.style.overflow;
    if (scroll) scroll.style.overflow = "hidden";
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (scroll) scroll.style.overflow = overflow ?? "";
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`ego-modal ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}
