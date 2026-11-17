"use client";

import type { ComponentProps } from "react";

// A <form> that asks for confirmation before running a destructive action.
// Lets server components guard their delete forms without becoming clients.
export default function ConfirmForm({
  message,
  onSubmit,
  ...props
}: ComponentProps<"form"> & { message: string }) {
  return (
    <form
      {...props}
      onSubmit={(e) => {
        if (!window.confirm(message)) {
          e.preventDefault();
          return;
        }
        onSubmit?.(e);
      }}
    />
  );
}
