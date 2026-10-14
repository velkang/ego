import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { LargeCoin } from "./Coin";
import { Modal } from "./Modal";
const KEY = "ego.onboarded";
const slides = [
  {
    title: "Money, made fun",
    body: "Your USDC wallet. Send, receive, and discover new ways to get paid.",
  },
  {
    title: "Find money in the real world",
    body: "Explore money drops at cafés, campuses, and events. Follow the distance dial, reach the claiming area, and hold to claim.",
  },
  {
    title: "Get paid for what you win",
    body: "Won a hackathon or a bounty? Sign in with your assigned email to find and claim your prizes.",
  },
];
export function Onboarding({
  requestSignIn,
  signedIn,
}: {
  requestSignIn: () => void;
  signedIn: boolean;
}) {
  const [show, setShow] = useState(false),
    [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      setShow(!localStorage.getItem(KEY));
    } catch {
      /* Blocked storage: keep the app usable. */
    }
  }, []);
  function done() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* Storage is optional. */
    }
    setShow(false);
  }
  function go(next: number) {
    const target = Math.max(0, Math.min(slides.length - 1, next));
    setIndex(target);
    track.current?.scrollTo({
      left: target * track.current.clientWidth,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  if (!show) return null;
  return (
    <Modal titleId="onboarding-title" className="onboarding" onClose={done}>
      <h2 id="onboarding-title" className="sr-only">
        Welcome to Ego
      </h2>
      <button className="onboarding-skip" onClick={done} autoFocus>
        Skip
      </button>
      <div className="onboarding-coin">
        <LargeCoin size={230} entrance="drop" />
      </div>
      <div
        className="onboarding-track"
        ref={track}
        onScroll={(e) => {
          const width = e.currentTarget.clientWidth;
          if (width) setIndex(Math.round(e.currentTarget.scrollLeft / width));
        }}
      >
        {slides.map((slide, i) => (
          <section
            className="onboarding-slide"
            key={slide.title}
            aria-hidden={i !== index}
          >
            <h3>{slide.title}</h3>
            <p>{slide.body}</p>
          </section>
        ))}
      </div>
      <div
        className="onboarding-dots"
        role="group"
        aria-label="Onboarding steps"
      >
        {slides.map((slide, i) => (
          <button
            key={slide.title}
            aria-label={`Step ${i + 1}: ${slide.title}`}
            aria-current={i === index ? "step" : undefined}
            className={i === index ? "on" : ""}
            onClick={() => go(i)}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="onboarding-actions">
        {index === slides.length - 1 ? (
          <>
            <button
              className="button primary"
              onClick={() => {
                done();
                if (!signedIn) requestSignIn();
              }}
            >
              {signedIn ? "Continue" : "Continue with email"}{" "}
              <ArrowRight size={18} />
            </button>
            <button className="button ghost" onClick={done}>
              Look around first
            </button>
          </>
        ) : (
          <button className="button primary" onClick={() => go(index + 1)}>
            Next <ArrowRight size={18} />
          </button>
        )}
      </div>
    </Modal>
  );
}
