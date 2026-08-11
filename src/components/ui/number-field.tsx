import { forwardRef, useEffect, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

type NumberFieldProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  /** null = champ vide (aucune valeur), jamais confondu avec 0. */
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  allowDecimal?: boolean;
  allowNegative?: boolean;
};

/**
 * Champ numérique unique pour toute l'app : vider le champ donne `null` (jamais
 * `0` réinjecté automatiquement), et `0` saisi explicitement reste `0`. Le texte
 * tapé est conservé tel quel pendant la saisie (permet "12.", "-", etc.) et
 * n'est converti en nombre qu'une fois une valeur valide obtenue — jamais de
 * `Number(e.target.value) || 0` qui écraserait un champ vidé.
 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(
  ({ value, onChange, allowDecimal = true, allowNegative = false, onBlur, ...rest }, ref) => {
    const [draft, setDraft] = useState(value == null ? "" : String(value));

    // Resynchronise depuis l'extérieur (reset de formulaire, chargement de données…)
    // sans écraser une saisie en cours si la valeur externe n'a pas vraiment changé.
    useEffect(() => {
      setDraft((prev) => {
        const external = value == null ? "" : String(value);
        const prevAsNumber = prev === "" || prev === "-" ? null : Number(prev);
        if (prevAsNumber === value || (value == null && prev === "")) return prev;
        return external;
      });
    }, [value]);

    const pattern = allowNegative
      ? allowDecimal ? /^-?\d*\.?\d*$/ : /^-?\d*$/
      : allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/;

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw !== "" && !pattern.test(raw)) return; // ignore les caractères invalides, ne touche pas au draft
          setDraft(raw);
          const isIncomplete = raw === "" || raw === "-" || raw === "." || raw === "-.";
          if (isIncomplete) {
            onChange(raw === "" ? null : value ?? null); // vide réel → null ; état transitoire ("-", ".") → ne change pas encore la valeur validée
          } else {
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(n);
          }
        }}
        onBlur={(e) => {
          // Si la saisie s'est arrêtée sur un état transitoire invalide ("-", "12."),
          // on nettoie l'affichage vers la dernière valeur valide au lieu de la laisser en l'air.
          setDraft(value == null ? "" : String(value));
          onBlur?.(e);
        }}
      />
    );
  },
);
NumberField.displayName = "NumberField";
