"use client";

import { useId, useMemo, useState } from "react";
import {
  indexCustomers,
  matchCustomers,
  type CustomerOption,
} from "./customer-matches";

export function CustomerPicker({
  customers,
  value,
  onChange,
  disabled = false,
}: {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = customers.find((customer) => customer.id === value);
  const searchIndex = useMemo(() => indexCustomers(customers), [customers]);
  const matches = useMemo(
    () => matchCustomers(searchIndex, query),
    [searchIndex, query],
  );
  function choose(customer: CustomerOption) {
    onChange(customer.id);
    setQuery("");
    setOpen(false);
  }
  return (
    <div
      className="customer-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        className="customer-picker-input"
        aria-label="고객 이름 또는 전화번호 검색"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && matches[active] ? `${listId}-${active}` : undefined
        }
        autoComplete="off"
        disabled={disabled}
        value={
          open ? query : selected ? `${selected.name} · ${selected.id}` : query
        }
        placeholder="이름 또는 전화번호로 찾기"
        onFocus={(event) => {
          setOpen(!selected);
          setActive(0);
          if (selected) event.currentTarget.select();
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange("");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((index) =>
              matches.length
                ? (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    matches.length) %
                  matches.length
                : 0,
            );
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            if (matches[active]) choose(matches[active]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div
          className="customer-picker-results"
          id={listId}
          role="listbox"
          aria-label="고객 검색 결과"
        >
          {!matches.length && (
            <p className="customer-picker-empty">
              일치하는 고객이 없습니다. 아래에서 새 고객을 등록해 주세요.
            </p>
          )}
          {matches.map((customer, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              id={`${listId}-${index}`}
              className="customer-picker-option"
              key={customer.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(customer)}
            >
              <strong>{customer.name}</strong>
              <small>{customer.id}</small>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <span className="customer-picker-selected">
          선택됨: {selected.name} · {selected.id}
        </span>
      )}
    </div>
  );
}
