// SVG markup of the icons the reading view uses:
// [class suffix, inner markup]. Lucide icons (ISC licence, https://lucide.dev);
// `right-triangle` is a plain chevron path. Other ids fall back to the `lucide` package.
export const ICON_MARKUP: Record<string, [string, string]> = {
  "lucide-copy": ["lucide-copy", "<rect x=\"8\" y=\"8\" width=\"14\" height=\"14\" rx=\"2\" ry=\"2\"></rect><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"></path>"],
  "lucide-check": ["lucide-check", "<path d=\"M20 6 9 17l-5-5\"></path>"],
  "lucide-chevron-down": ["lucide-chevron-down", "<path d=\"m6 9 6 6 6-6\"></path>"],
  "right-triangle": ["right-triangle", "<path d=\"M3 8L12 17L21 8\"></path>"],
  "lucide-pencil": ["lucide-pencil", "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"></path><path d=\"m15 5 4 4\"></path>"],
  "lucide-clipboard-list": ["lucide-clipboard-list", "<rect x=\"8\" y=\"2\" width=\"8\" height=\"4\" rx=\"1\" ry=\"1\"></rect><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"></path><path d=\"M12 11h4\"></path><path d=\"M12 16h4\"></path><path d=\"M8 11h.01\"></path><path d=\"M8 16h.01\"></path>"],
  "lucide-info": ["lucide-info", "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"M12 16v-4\"></path><path d=\"M12 8h.01\"></path>"],
  "lucide-check-circle-2": ["lucide-check-circle-2", "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"m9 12 2 2 4-4\"></path>"],
  "lucide-flame": ["lucide-flame", "<path d=\"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4\"></path>"],
  "help-circle": ["lucide-help-circle", "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\"></path><path d=\"M12 17h.01\"></path>"],
  "lucide-alert-triangle": ["lucide-alert-triangle", "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"></path><path d=\"M12 9v4\"></path><path d=\"M12 17h.01\"></path>"],
  "lucide-x": ["lucide-x", "<path d=\"M18 6 6 18\"></path><path d=\"m6 6 12 12\"></path>"],
  "lucide-zap": ["lucide-zap", "<path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\"></path>"],
  "lucide-bug": ["lucide-bug", "<path d=\"M12 20v-9\"></path><path d=\"M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z\"></path><path d=\"M14.12 3.88 16 2\"></path><path d=\"M21 21a4 4 0 0 0-3.81-4\"></path><path d=\"M21 5a4 4 0 0 1-3.55 3.97\"></path><path d=\"M22 13h-4\"></path><path d=\"M3 21a4 4 0 0 1 3.81-4\"></path><path d=\"M3 5a4 4 0 0 0 3.55 3.97\"></path><path d=\"M6 13H2\"></path><path d=\"m8 2 1.88 1.88\"></path><path d=\"M9 7.13V6a3 3 0 1 1 6 0v1.13\"></path>"],
  "lucide-list": ["lucide-list", "<path d=\"M3 5h.01\"></path><path d=\"M3 12h.01\"></path><path d=\"M3 19h.01\"></path><path d=\"M8 5h13\"></path><path d=\"M8 12h13\"></path><path d=\"M8 19h13\"></path>"],
  "lucide-search": ["lucide-search", "<path d=\"m21 21-4.34-4.34\"></path><circle cx=\"11\" cy=\"11\" r=\"8\"></circle>"],
  "lucide-maximize-2": ["lucide-maximize-2", "<path d=\"M15 3h6v6\"></path><path d=\"m21 3-7 7\"></path><path d=\"m3 21 7-7\"></path><path d=\"M9 21H3v-6\"></path>"],
  "lucide-file": ["lucide-file", "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"></path><path d=\"M14 2v5a1 1 0 0 0 1 1h5\"></path>"],
  "lucide-image": ["lucide-image", "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" ry=\"2\"></rect><circle cx=\"9\" cy=\"9\" r=\"2\"></circle><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"></path>"],
  "lucide-link": ["lucide-link", "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"></path><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"></path>"],
  "lucide-tags": ["lucide-tags", "<path d=\"M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z\"></path><path d=\"M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193\"></path><circle cx=\"10.5\" cy=\"6.5\" r=\"0.5\" fill=\"currentColor\"></circle>"],
  "lucide-plus": ["lucide-plus", "<path d=\"M5 12h14\"></path><path d=\"M12 5v14\"></path>"],
  "quote-glyph": ["lucide-quote", "<path d=\"M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z\"></path><path d=\"M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z\"></path>"],
}
