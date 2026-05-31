(function () {
    // No mostrar en demo ni en páginas de recursos
    var path = window.location.pathname;
    if (path.includes('/demo') || path.includes('/recursos') || path.includes('/r/') || path.includes('/p/')) return;

    // Mostrar solo una vez por sesión
    if (sessionStorage.getItem('lm_shown')) return;

    // Mínimo 20 segundos en la página antes de activar
    var readyTime = Date.now() + 20000;
    var popupShown = false;

    // ── Datos de cada Lead Magnet ───────────────────────────────
    var LM = {
        calculadora: {
            emoji: '🧮',
            tag: 'Herramienta gratuita',
            title: '¿Cuántas horas pierdes en WhatsApp cada mes?',
            desc: 'Calculadora en 2 minutos. Descubre el número exacto — y lo que podrías hacer con ese tiempo libre.',
            cta: 'Calcular mis horas perdidas →',
            url: '/recursos/calculadora',
            wa: 'Hola%21+Quiero+calcular+cu%C3%A1ntas+horas+pierdo+gestionando+el+WhatsApp+de+mi+cl%C3%ADnica+%F0%9F%A7%AE'
        },
        script: {
            emoji: '📋',
            tag: 'Script gratuito',
            title: 'El script de 3 mensajes que elimina los no-shows',
            desc: 'El protocolo exacto — con timing y copy listo — que usan las clínicas con 0% de inasistencias.',
            cta: 'Quiero el script gratis →',
            url: '/recursos/script-no-shows',
            wa: 'Hola%21+Quiero+el+script+de+3+mensajes+para+eliminar+no-shows+en+mi+cl%C3%ADnica+%F0%9F%93%8B'
        },
        ruta: {
            emoji: '🗺️',
            tag: 'Plantilla gratuita',
            title: 'Plantilla de ruta semanal para clínica veterinaria móvil',
            desc: 'Organiza tus visitas por sector, calcula tiempos y elimina el caos de la ruta. Lista para usar el lunes.',
            cta: 'Recibir la plantilla →',
            url: '/recursos/ruta-movil',
            wa: 'Hola%21+Quiero+la+plantilla+de+ruta+semanal+para+mi+cl%C3%ADnica+veterinaria+m%C3%B3vil+%F0%9F%97%BA%EF%B8%8F'
        },
        diagnostico: {
            emoji: '🔍',
            tag: 'Diagnóstico gratuito',
            title: '¿Tu WhatsApp está frenando el crecimiento de tu clínica?',
            desc: '7 preguntas. Resultado personalizado. Descubre si tu gestión de WhatsApp está costándote clientes.',
            cta: 'Hacer el diagnóstico →',
            url: '/recursos/diagnostico',
            wa: 'Hola%21+Quiero+el+diagn%C3%B3stico+de+WhatsApp+para+mi+cl%C3%ADnica+veterinaria+%F0%9F%94%8D'
        }
    };

    // ── Mapa de relevancia por artículo ─────────────────────────
    var MAP = {
        calculadora: ['whatsapp-clinica', 'recepcionista-virtual', 'agente-ia', 'burnout', 'conseguir-clientes'],
        script:      ['recordatorios', 'metricas-rentabilidad', 'agenda-veterinaria', 'cobros'],
        ruta:        ['movil', 'inventario', 'ruta-clinica'],
        diagnostico: ['software-gestion', 'gestionar-dos', 'fidelizacion', 'precios-clinica']
    };

    function getLM() {
        for (var key in MAP) {
            for (var i = 0; i < MAP[key].length; i++) {
                if (path.includes(MAP[key][i])) return key;
            }
        }
        // Landing principal → diagnóstico
        if (path === '/' || path === '' || path === '/landing') return 'diagnostico';
        // Fallback aleatorio
        var keys = Object.keys(LM);
        return keys[Math.floor(Math.random() * keys.length)];
    }

    // ── Inyectar estilos ─────────────────────────────────────────
    var style = document.createElement('style');
    style.textContent = [
        '#lm-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem;opacity:0;transition:opacity .25s ease}',
        '#lm-overlay.visible{opacity:1}',
        '#lm-box{background:#fff;border-radius:1.25rem;max-width:420px;width:100%;padding:2rem 1.75rem;position:relative;box-shadow:0 24px 60px rgba(0,0,0,.18);transform:translateY(16px);transition:transform .25s ease}',
        '#lm-overlay.visible #lm-box{transform:translateY(0)}',
        '#lm-close{position:absolute;top:1rem;right:1rem;background:none;border:none;cursor:pointer;color:#a1a1aa;font-size:1.25rem;line-height:1;padding:0.25rem}',
        '#lm-close:hover{color:#18181b}',
        '.lm-tag{display:inline-block;font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#0d9488;background:#f0fdfa;border:1px solid #99f6e4;padding:.2rem .625rem;border-radius:100px;margin-bottom:.875rem}',
        '.lm-emoji{font-size:2rem;margin-bottom:.625rem;display:block}',
        '.lm-title{font-size:1.125rem;font-weight:900;color:#18181b;line-height:1.25;letter-spacing:-.02em;margin-bottom:.625rem;font-family:Outfit,sans-serif}',
        '.lm-desc{font-size:.875rem;color:#52525b;line-height:1.6;margin-bottom:1.25rem;font-family:Outfit,sans-serif}',
        '.lm-cta-wa{display:flex;align-items:center;justify-content:center;gap:.625rem;background:#25D366;color:#fff;font-weight:800;font-size:.9375rem;padding:.875rem 1.5rem;border-radius:.75rem;text-decoration:none;width:100%;box-sizing:border-box;transition:background .15s,transform .15s;font-family:Outfit,sans-serif}',
        '.lm-cta-wa:hover{background:#1ebe5d;transform:translateY(-1px)}',
        '.lm-wa-icon{flex-shrink:0}',
        '.lm-skip{display:block;text-align:center;font-size:.75rem;color:#a1a1aa;margin-top:.875rem;cursor:pointer;font-family:Outfit,sans-serif}',
        '.lm-skip:hover{color:#71717a}',
        '@media(max-width:480px){#lm-box{padding:1.5rem 1.25rem}.lm-title{font-size:1rem}}'
    ].join('');
    document.head.appendChild(style);

    // ── Crear el overlay ─────────────────────────────────────────
    function createPopup(lmKey) {
        var d = LM[lmKey];
        var overlay = document.createElement('div');
        overlay.id = 'lm-overlay';
        overlay.innerHTML = [
            '<div id="lm-box">',
            '  <button id="lm-close" aria-label="Cerrar">✕</button>',
            '  <span class="lm-emoji">' + d.emoji + '</span>',
            '  <span class="lm-tag">' + d.tag + '</span>',
            '  <p class="lm-title">' + d.title + '</p>',
            '  <p class="lm-desc">' + d.desc + '</p>',
            '  <a class="lm-cta-wa" href="https://wa.me/56993089185?text=' + d.wa + '" target="_blank" rel="noopener">',
            '    <svg class="lm-wa-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.83 9.83 0 0 0 1.51 5.26l-.999 3.648 3.477-1.207zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>',
            '    ' + d.cta,
            '  </a>',
            '  <span class="lm-skip" id="lm-skip">No gracias, seguir navegando</span>',
            '</div>'
        ].join('');
        document.body.appendChild(overlay);

        // Animar entrada
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { overlay.classList.add('visible'); });
        });

        // Cerrar
        function close() {
            overlay.classList.remove('visible');
            setTimeout(function () { overlay.remove(); }, 300);
            sessionStorage.setItem('lm_shown', '1');
        }
        document.getElementById('lm-close').addEventListener('click', close);
        document.getElementById('lm-skip').addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

        // Marcar también al hacer clic en el CTA
        overlay.querySelector('.lm-cta-wa').addEventListener('click', function () {
            sessionStorage.setItem('lm_shown', '1');
        });
    }

    function show() {
        if (popupShown || Date.now() < readyTime) return;
        popupShown = true;
        createPopup(getLM());
    }

    // ── Desktop: exit intent (cursor sale por arriba) ────────────
    document.addEventListener('mouseleave', function (e) {
        if (e.clientY <= 5) show();
    });

    // ── Mobile: después de 40 segundos en la página ──────────────
    if ('ontouchstart' in window) {
        setTimeout(show, 40000);
    }
})();
