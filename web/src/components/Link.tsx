import type { ComponentProps } from "react";
import { navigate } from "../lib/router";
export function Link({ href = "", onClick, ...props }: ComponentProps<"a">) {
  return (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (
          !e.defaultPrevented &&
          e.button === 0 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !props.target &&
          href.startsWith("/")
        ) {
          e.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}
