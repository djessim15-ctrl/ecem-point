/* ============================================================================
 * ECEM Point — jeu d'icônes
 * ----------------------------------------------------------------------------
 * De petites icônes SVG « au trait » (inspirées de Lucide, licence ISC), pour
 * remplacer les emojis partout dans l'interface. Elles héritent de la couleur
 * du texte (currentColor) et de la taille demandée.
 *
 *   ECEM.Icon('trophy')                  -> <svg class="ico">
 *   ECEM.Icon('star', { size: 28 })      -> plus grand
 *   ECEM.iconHTML('check', 16)           -> chaîne, pour du HTML statique
 * ==========================================================================*/
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  var P = {
    home:      '<path d="M3 10.7 12 3.4l9 7.3"/><path d="M5.4 9.6V20a1 1 0 0 0 1 1h11.2a1 1 0 0 0 1-1V9.6"/><path d="M9.6 21v-6.2h4.8V21"/>',
    star:      '<path d="m12 3.2 2.72 5.86 6.28.72-4.66 4.32 1.28 6.1L12 17.1l-5.62 3.1 1.28-6.1L3 9.78l6.28-.72z"/>',
    sparkles:  '<path d="m11.5 3 1.65 4.35L17.5 9l-4.35 1.65L11.5 15 9.85 10.65 5.5 9l4.35-1.65z"/><path d="m18.5 14.5.85 2.15L21.5 17.5l-2.15.85L18.5 20.5l-.85-2.15L15.5 17.5l2.15-.85z"/><path d="m5.5 15 .6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L3.5 17l1.4-.6z"/>',
    trophy:    '<path d="M8 4h8v4.6a4 4 0 0 1-8 0z"/><path d="M8 5.4H5.2A2.8 2.8 0 0 0 8 10.2"/><path d="M16 5.4h2.8A2.8 2.8 0 0 1 16 10.2"/><path d="M12 12.8V17"/><path d="M8.6 21h6.8"/><path d="M9.8 17h4.4l.6 4H9.2z"/>',
    crown:     '<path d="M3 7.5 7.2 11l4.8-6.6 4.8 6.6L21 7.5 19 18a1.5 1.5 0 0 1-1.5 1.3H5.5A1.5 1.5 0 0 1 4 18z"/><path d="M5.5 15.2h13"/>',
    medal:     '<circle cx="12" cy="9" r="5.2"/><path d="m8.6 13.4-1.8 7.4L12 18l5.2 2.8-1.8-7.4"/><path d="m12 6.6.9 1.9 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 8.8l2-.3z"/>',
    send:      '<path d="M21.3 2.7 2.9 9.6l7.5 3 .9 8.7 4.2-5.6"/><path d="M21.3 2.7 10.4 12.6"/>',
    gift:      '<path d="M19.4 12.4V20a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1v-7.6"/><path d="M3 7.6h18v4.8H3z"/><path d="M12 7.6V21"/><path d="M12 7.6C10.4 7.6 8 6.7 8 4.7A2.1 2.1 0 0 1 12 3.6a2.1 2.1 0 0 1 4 1.1c0 2-2.4 2.9-4 2.9z"/>',
    users:     '<path d="M15.5 20.5v-1.8a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4v1.8"/><circle cx="9" cy="7.2" r="3.8"/><path d="M21.5 20.5v-1.8a4 4 0 0 0-3-3.85"/><path d="M15.6 3.6a4 4 0 0 1 0 7.5"/>',
    user:      '<circle cx="12" cy="7.6" r="4.1"/><path d="M4.5 21v-1.5a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5V21"/>',
    chat:      '<path d="M20.5 11.6a8 8 0 0 1-8.6 8 8.7 8.7 0 0 1-3.9-.95L3.5 20.5l1.85-4.3A8 8 0 0 1 12 3.4a8 8 0 0 1 8.5 8.2z"/>',
    chart:     '<path d="M3.5 3.5v17h17"/><path d="M7.6 16.4v2.6"/><path d="M12 10.6v8.4"/><path d="M16.4 6.6v12.4"/>',
    trending:  '<path d="m3.5 16.5 5.2-5.2 3.4 3.4 6.4-6.4"/><path d="M14.4 8.3h4.1v4.1"/>',
    history:   '<path d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1L3.5 8.4"/><path d="M3.4 3.6v4.8h4.8"/><path d="M12 7.6V12l3.1 1.9"/>',
    award:     '<circle cx="12" cy="9" r="5.6"/><path d="m8.4 13.5-1.6 7.9 5.2-2.9 5.2 2.9-1.6-7.9"/>',
    settings:  '<circle cx="12" cy="12" r="3.1"/><path d="M19.5 14.4a1.6 1.6 0 0 0 .32 1.77l.06.06a1.95 1.95 0 1 1-2.76 2.76l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a1.95 1.95 0 1 1-3.9 0v-.12a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a1.95 1.95 0 1 1-2.76-2.76l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3a1.95 1.95 0 1 1 0-3.9h.12a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.95 1.95 0 1 1 2.76-2.76l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 .97-1.47V3a1.95 1.95 0 1 1 3.9 0v.12a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.95 1.95 0 1 1 2.76 2.76l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47.97H21a1.95 1.95 0 1 1 0 3.9h-.12a1.6 1.6 0 0 0-1.38.53z"/>',
    sun:       '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.1M12 19.3v2.1M4.3 4.3l1.5 1.5M18.2 18.2l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.3 19.7l1.5-1.5M18.2 5.8l1.5-1.5"/>',
    moon:      '<path d="M20.7 13.3A8.9 8.9 0 1 1 10.7 3.3a7 7 0 0 0 10 10z"/>',
    logout:    '<path d="M9.4 21H5.2A1.7 1.7 0 0 1 3.5 19.3V4.7A1.7 1.7 0 0 1 5.2 3h4.2"/><path d="m15.8 16.4 4.4-4.4-4.4-4.4"/><path d="M20.2 12H9.4"/>',
    search:    '<circle cx="10.8" cy="10.8" r="7.2"/><path d="m16.2 16.2 4.3 4.3"/>',
    check:     '<path d="m4.5 12.4 4.6 4.6L19.5 6.6"/>',
    x:         '<path d="m6 6 12 12M18 6 6 18"/>',
    plus:      '<path d="M12 5v14M5 12h14"/>',
    minus:     '<path d="M5 12h14"/>',
    'chevron-down':  '<path d="m6 9.5 6 6 6-6"/>',
    'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
    'chevron-left':  '<path d="m14.5 6-6 6 6 6"/>',
    'arrow-right':   '<path d="M4 12h16"/><path d="m14.5 6.5 5.5 5.5-5.5 5.5"/>',
    'arrow-up':      '<path d="M12 20V5"/><path d="m6.5 10.5 5.5-5.5 5.5 5.5"/>',
    'arrow-down':    '<path d="M12 4v15"/><path d="m6.5 13.5 5.5 5.5 5.5-5.5"/>',
    'arrow-up-right':'<path d="M7 17 17 7"/><path d="M8.5 7H17v8.5"/>',
    'arrow-down-right':'<path d="M7 7l10 10"/><path d="M17 8.5V17H8.5"/>',
    flame:     '<path d="M12 21.2c3.9 0 6.2-2.6 6.2-6 0-2.6-1.3-4.4-2.5-5.9-.6-.8-1.6-.4-1.6.6 0 1.2-.9 2.2-1.6 1.2-.9-1.3-1-3.4-1-4.6 0-.8-1-1.2-1.5-.5-2.2 2.6-3.2 4.8-3.2 7.2 0 4.4 1.9 8 5.2 8z"/><path d="M12 21.2c-1.7 0-2.8-1.4-2.8-3 0-1.6 1.3-2.7 2-4.1.3-.5 1.1-.5 1.3.1.7 1.6 2.3 2.3 2.3 4 0 1.6-1.2 3-2.8 3z"/>',
    zap:       '<path d="M13.4 2.5 4.6 14h6.1l-.9 7.5 9-11.6h-6.2z"/>',
    target:    '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1"/>',
    shield:    '<path d="M12 21.5s7.6-3.6 7.6-9.5V5.6L12 2.8 4.4 5.6V12c0 5.9 7.6 9.5 7.6 9.5z"/><path d="m8.8 11.8 2.3 2.3 4.4-4.4"/>',
    bell:      '<path d="M18.4 8.9a6.4 6.4 0 1 0-12.8 0c0 6-2.6 7.6-2.6 7.6h18s-2.6-1.6-2.6-7.6z"/><path d="M13.8 20.4a2 2 0 0 1-3.6 0"/>',
    clock:     '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.4 2"/>',
    calendar:  '<rect x="3.5" y="5.2" width="17" height="15.3" rx="2.4"/><path d="M8 3.4v3.6M16 3.4v3.6M3.5 10.2h17"/>',
    download:  '<path d="M12 3.5v11.4"/><path d="m7.4 10.6 4.6 4.6 4.6-4.6"/><path d="M4.4 19.5h15.2"/>',
    upload:    '<path d="M12 20.5V9.1"/><path d="m7.4 13.4 4.6-4.6 4.6 4.6"/><path d="M4.4 4.5h15.2"/>',
    copy:      '<rect x="8.6" y="8.6" width="11.9" height="11.9" rx="2.4"/><path d="M15.4 8.6V6.2a2.4 2.4 0 0 0-2.4-2.4H6.2A2.4 2.4 0 0 0 3.8 6.2v6.8a2.4 2.4 0 0 0 2.4 2.4h2.4"/>',
    refresh:   '<path d="M20.5 11.6a8.5 8.5 0 1 1-2.4-5.9"/><path d="M20.5 3.9v5.2h-5.2"/>',
    wifi:      '<path d="M2.4 8.7a15.5 15.5 0 0 1 19.2 0"/><path d="M5.8 12.5a10.4 10.4 0 0 1 12.4 0"/><path d="M9.2 16.2a5.3 5.3 0 0 1 5.6 0"/><circle cx="12" cy="19.6" r="1.1" fill="currentColor" stroke="none"/>',
    'wifi-off': '<path d="m2.6 3.2 18 18"/><path d="M9.2 16.2a5.3 5.3 0 0 1 5.6 0"/><path d="M5.8 12.5a10.4 10.4 0 0 1 5.4-2.6"/><path d="M14.4 10.1a10.4 10.4 0 0 1 3.8 2.4"/><path d="M2.4 8.7a15.4 15.4 0 0 1 4.6-2.7"/><path d="M14.2 6.2a15.5 15.5 0 0 1 7.4 2.5"/><circle cx="12" cy="19.6" r="1.1" fill="currentColor" stroke="none"/>',
    lock:      '<rect x="4.4" y="10.6" width="15.2" height="10.6" rx="2.6"/><path d="M8.1 10.6V7.4a3.9 3.9 0 0 1 7.8 0v3.2"/>',
    key:       '<circle cx="7.8" cy="16.2" r="3.4"/><path d="m10.2 13.8 8.2-8.2"/><path d="m16.4 7.6 2.2 2.2"/><path d="m14.2 9.8 2.2 2.2"/>',
    eye:       '<path d="M2.5 12S6 5.6 12 5.6 21.5 12 21.5 12 18 18.4 12 18.4 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.1"/>',
    'eye-off': '<path d="m3 3 18 18"/><path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.3 4"/><path d="M6.2 7.9A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    smile:     '<circle cx="12" cy="12" r="8.8"/><path d="M8.2 14.1a4.4 4.4 0 0 0 7.6 0"/><path d="M9.1 9.4h.01M14.9 9.4h.01"/>',
    filter:    '<path d="M3.6 5.2h16.8l-6.6 7.9v6l-3.6 2v-8z"/>',
    info:      '<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.4"/><path d="M12 7.9h.01"/>',
    alert:     '<path d="M10.5 3.6 2.7 17a1.7 1.7 0 0 0 1.5 2.5h15.6a1.7 1.7 0 0 0 1.5-2.5L13.5 3.6a1.7 1.7 0 0 0-3 0z"/><path d="M12 9v4.2"/><path d="M12 16.6h.01"/>',
    'check-circle': '<circle cx="12" cy="12" r="8.8"/><path d="m8.2 12.2 2.6 2.6 5-5"/>',
    loader:    '<path d="M12 3.4v3.2M12 17.4v3.2M5.9 5.9l2.3 2.3M15.8 15.8l2.3 2.3M3.4 12h3.2M17.4 12h3.2M5.9 18.1l2.3-2.3M15.8 8.2l2.3-2.3"/>',
    menu:      '<path d="M3.8 6.6h16.4M3.8 12h16.4M3.8 17.4h16.4"/>',
    wand:      '<path d="m3.5 20.5 11-11"/><path d="m14.5 9.5 2-2"/><path d="M17.5 3v3M16 4.5h3M20.5 9v2M19.5 10h2M11.5 3v2M10.5 4h2"/>',
    palette:   '<path d="M12 21a9 9 0 1 1 9-9c0 2.5-2 3.4-3.6 3.4h-1.8a2 2 0 0 0-1.4 3.4 1.8 1.8 0 0 1-1.3 3z"/><circle cx="8.4" cy="10.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.8" cy="9.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.2" cy="14.4" r="1.1" fill="currentColor" stroke="none"/>',
    mail:      '<rect x="2.8" y="4.6" width="18.4" height="14.8" rx="2.6"/><path d="m3.6 6.8 8.4 5.7 8.4-5.7"/>',
    link:      '<path d="M10.2 13.8a4.4 4.4 0 0 0 6.2 0l2.6-2.6a4.4 4.4 0 0 0-6.2-6.2l-1.2 1.2"/><path d="M13.8 10.2a4.4 4.4 0 0 0-6.2 0l-2.6 2.6a4.4 4.4 0 0 0 6.2 6.2l1.2-1.2"/>',
    trash:     '<path d="M4.5 6.5h15"/><path d="M9 6.5V4.4h6v2.1"/><path d="M6.2 6.5 7.3 20a1.4 1.4 0 0 0 1.4 1.3h6.6a1.4 1.4 0 0 0 1.4-1.3l1.1-13.5"/><path d="M10.4 10.5v6M13.6 10.5v6"/>',
    edit:      '<path d="M4 20h4.2L20 8.2a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8z"/>',
    share:     '<circle cx="6.2" cy="12" r="2.8"/><circle cx="17.8" cy="6.2" r="2.8"/><circle cx="17.8" cy="17.8" r="2.8"/><path d="m8.7 10.7 6.6-3.3M8.7 13.3l6.6 3.3"/>',
    dots:      '<circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none"/>',
    grid:      '<rect x="3.6" y="3.6" width="7" height="7" rx="1.8"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.8"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.8"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.8"/>',
    heart:     '<path d="M12 20.4 4.6 13a4.9 4.9 0 0 1 7-6.9l.4.4.4-.4a4.9 4.9 0 1 1 7 6.9z"/>',
    bolt:      '<path d="M13.4 2.5 4.6 14h6.1l-.9 7.5 9-11.6h-6.2z"/>',
    pulse:     '<path d="M2.6 12h4l2.4-6.4 4.6 13 2.6-6.6h5.2"/>',
    compass:   '<circle cx="12" cy="12" r="8.8"/><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z"/>',
    book:      '<path d="M4.4 4.6A1.6 1.6 0 0 1 6 3h13v18H6a1.6 1.6 0 0 0-1.6 1.6z"/><path d="M4.4 19.6A1.6 1.6 0 0 1 6 18h13"/>',
    gift2:     '<path d="M19.4 12.4V20a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1v-7.6"/><path d="M3 7.6h18v4.8H3z"/><path d="M12 7.6V21"/>',
    dot:       '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/>',
    github:    '<path fill="currentColor" stroke="none" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.3-3.2-.2-.3-.6-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 3 .1 3.3.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.2.9 2.3v3.4c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>'
  };

  function Icon(name, opts) {
    opts = opts || {};
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', opts.size || 20);
    svg.setAttribute('height', opts.size || 20);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', opts.stroke || 1.7);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'ico' + (opts.class ? ' ' + opts.class : ''));
    svg.innerHTML = P[name] || P.dot;
    return svg;
  }

  function iconHTML(name, size, cls) {
    size = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false" class="ico' + (cls ? ' ' + cls : '') + '">' +
      (P[name] || P.dot) + '</svg>';
  }

  window.ECEM = window.ECEM || {};
  window.ECEM.Icon = Icon;
  window.ECEM.iconHTML = iconHTML;
  window.ECEM.ICON_NAMES = Object.keys(P);
})();
