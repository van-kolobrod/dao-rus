"use client";

import { useSyncExternalStore } from "react";

const formatOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "medium",
};

export function formatLocalDateTime(value: string, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ru-RU", {
    ...formatOptions,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

type LocalDateTimeProps = {
  value: string;
};

const subscribe = () => () => undefined;
const serverFallback = "…";

export function LocalDateTime({ value }: LocalDateTimeProps) {
  const formatted = useSyncExternalStore(
    subscribe,
    () => formatLocalDateTime(value),
    () => serverFallback,
  );

  return <time dateTime={value}>{formatted}</time>;
}
