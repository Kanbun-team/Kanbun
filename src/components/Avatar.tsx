import { cn } from "@/lib/utils";
import { avatarColor } from "@/lib/palette";
import { safeAvatarUrl } from "@/lib/avatar";

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  online?: boolean;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

// Initials sit on a palette hue darkened to reach 4.5:1 with white text.
const colorFor = avatarColor;

export default function Avatar({
  src: rawSrc,
  name,
  size = 32,
  className,
  online,
}: AvatarProps) {
  const dotSize = Math.max(8, Math.round(size * 0.28));
  // Values saved before URLs were checked are ignored instead of loaded.
  const src = safeAvatarUrl(rawSrc);
  return (
    <span
      className={cn("relative inline-block shrink-0 align-middle", className)}
      style={{ width: size, height: size }}
    >
      <span
        className="block rounded-full overflow-hidden"
        style={{
          width: size,
          height: size,
          background: src ? "transparent" : colorFor(name),
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={name ?? ""}
            width={size}
            height={size}
            className="w-full h-full object-cover"
          />
        ) : (
          <span
            className="w-full h-full flex items-center justify-center text-white font-semibold"
            style={{ fontSize: Math.max(10, Math.round(size * 0.4)) }}
          >
            {initials(name)}
          </span>
        )}
      </span>
      {online !== undefined && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface",
            online ? "bg-success" : "bg-ink-muted"
          )}
          style={{ width: dotSize, height: dotSize }}
          role="img"
          aria-label={online ? "online" : "offline"}
        />
      )}
    </span>
  );
}
