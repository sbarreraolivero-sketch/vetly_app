# Email Templates para Citenly AI

Los siguientes templates deben configurarse en:
**Supabase → Authentication → Email Templates**

---

## 1. Reset Password (Recuperar Contraseña)

### Subject:
```
Recupera tu acceso a Citenly AI
```

### Body (HTML):
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f3ef; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f3ef; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1F6F5C 0%, #2D8B73 100%); padding: 32px; text-align: center;">
              <div style="display: inline-block; background-color: rgba(255,255,255,0.15); padding: 12px; border-radius: 12px;">
                <span style="color: white; font-size: 24px;">✨</span>
              </div>
              <h1 style="color: white; margin: 16px 0 0 0; font-size: 24px; font-weight: 600;">Citenly AI</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 32px;">
              <h2 style="color: #2D3748; margin: 0 0 16px 0; font-size: 22px; font-weight: 600;">
                Recupera tu acceso
              </h2>
              <p style="color: #4A5568; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Citenly AI. 
                Haz clic en el botón de abajo para crear una nueva contraseña.
              </p>
              
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 8px 0 32px 0;">
                    <a href="{{ .ConfirmationURL }}" 
                       style="display: inline-block; background: linear-gradient(135deg, #1F6F5C 0%, #2D8B73 100%); 
                              color: white; text-decoration: none; padding: 16px 40px; border-radius: 12px; 
                              font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(31, 111, 92, 0.3);">
                      Restablecer contraseña
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #718096; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
                Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña seguirá siendo la misma.
              </p>
              
              <p style="color: #A0AEC0; font-size: 12px; margin: 0;">
                Este enlace expira en 60 minutos.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f7f5; padding: 24px 32px; border-top: 1px solid #E2E8F0;">
              <p style="color: #A0AEC0; font-size: 12px; margin: 0; text-align: center;">
                © 2026 Citenly AI. Todos los derechos reservados.<br>
                <a href="https://citenly.com" style="color: #1F6F5C; text-decoration: none;">citenly.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 2. Confirm Signup (Confirmar Registro)

### Subject:
```
¡Bienvenido a Citenly AI! Confirma tu cuenta
```

### Body (HTML):
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f3ef; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f3ef; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1F6F5C 0%, #2D8B73 100%); padding: 32px; text-align: center;">
              <div style="display: inline-block; background-color: rgba(255,255,255,0.15); padding: 12px; border-radius: 12px;">
                <span style="color: white; font-size: 24px;">✨</span>
              </div>
              <h1 style="color: white; margin: 16px 0 0 0; font-size: 24px; font-weight: 600;">Citenly AI</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 32px;">
              <h2 style="color: #2D3748; margin: 0 0 8px 0; font-size: 22px; font-weight: 600;">
                ¡Bienvenido! 🎉
              </h2>
              <p style="color: #1F6F5C; font-size: 16px; font-weight: 500; margin: 0 0 24px 0;">
                Tu asistente virtual está listo para transformar tu clínica
              </p>
              <p style="color: #4A5568; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Solo falta un paso para comenzar a automatizar la gestión de citas de tu clínica estética.
                Confirma tu correo electrónico haciendo clic en el botón de abajo.
              </p>
              
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 8px 0 32px 0;">
                    <a href="{{ .ConfirmationURL }}" 
                       style="display: inline-block; background: linear-gradient(135deg, #1F6F5C 0%, #2D8B73 100%); 
                              color: white; text-decoration: none; padding: 16px 40px; border-radius: 12px; 
                              font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(31, 111, 92, 0.3);">
                      Confirmar mi cuenta
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Features -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f7f5; border-radius: 12px; padding: 20px;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="color: #2D3748; font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">
                      Con Citenly AI podrás:
                    </p>
                    <p style="color: #4A5568; font-size: 14px; margin: 0 0 8px 0;">✓ Responder WhatsApp automáticamente 24/7</p>
                    <p style="color: #4A5568; font-size: 14px; margin: 0 0 8px 0;">✓ Agendar citas sin intervención manual</p>
                    <p style="color: #4A5568; font-size: 14px; margin: 0;">✓ Reducir no-shows con recordatorios inteligentes</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f7f5; padding: 24px 32px; border-top: 1px solid #E2E8F0;">
              <p style="color: #A0AEC0; font-size: 12px; margin: 0; text-align: center;">
                © 2026 Citenly AI. Todos los derechos reservados.<br>
                <a href="https://citenly.com" style="color: #1F6F5C; text-decoration: none;">citenly.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 3. Magic Link

### Subject:
```
Tu enlace de acceso a Citenly AI
```

### Body (HTML):
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f3ef; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f3ef; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1F6F5C 0%, #2D8B73 100%); padding: 32px; text-align: center;">
              <div style="display: inline-block; background-color: rgba(255,255,255,0.15); padding: 12px; border-radius: 12px;">
                <span style="color: white; font-size: 24px;">✨</span>
              </div>
              <h1 style="color: white; margin: 16px 0 0 0; font-size: 24px; font-weight: 600;">Citenly AI</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 32px;">
              <h2 style="color: #2D3748; margin: 0 0 16px 0; font-size: 22px; font-weight: 600;">
                Accede a tu cuenta
              </h2>
              <p style="color: #4A5568; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Haz clic en el siguiente botón para iniciar sesión en tu cuenta de Citenly AI de forma segura.
              </p>
              
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 8px 0 32px 0;">
                    <a href="{{ .ConfirmationURL }}" 
                       style="display: inline-block; background: linear-gradient(135deg, #1F6F5C 0%, #2D8B73 100%); 
                              color: white; text-decoration: none; padding: 16px 40px; border-radius: 12px; 
                              font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(31, 111, 92, 0.3);">
                      Iniciar sesión
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #718096; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
                Si no solicitaste este enlace, puedes ignorar este correo de forma segura.
              </p>
              
              <p style="color: #A0AEC0; font-size: 12px; margin: 0;">
                Este enlace expira en 60 minutos y solo puede usarse una vez.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f7f5; padding: 24px 32px; border-top: 1px solid #E2E8F0;">
              <p style="color: #A0AEC0; font-size: 12px; margin: 0; text-align: center;">
                © 2026 Citenly AI. Todos los derechos reservados.<br>
                <a href="https://citenly.com" style="color: #1F6F5C; text-decoration: none;">citenly.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## Instrucciones de Configuración

1. Ve a **Supabase Dashboard** → Tu proyecto
2. Click en **Authentication** (menú lateral)
3. Click en **Email Templates**
4. Para cada template (Confirm signup, Reset password, Magic link):
   - Click en el nombre del template
   - Cambia el **Subject**
   - Pega el **Body HTML**
   - Click **Save**
5. Prueba enviando un email de prueba
