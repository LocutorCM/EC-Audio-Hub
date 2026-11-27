import SwiftUI

struct AccountSheet: View {
    @EnvironmentObject private var library: ClientLibrary
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var isRegister = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("EC AUDIO ACCOUNT")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(1.5).foregroundColor(Color(hex: 0x70C9F2))
                    Text(library.accountEmail.isEmpty ? "Accede a tu cuenta" : "Tu cuenta EC Audio")
                        .font(.system(size: 25, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                }
                Spacer()
                Button("Cerrar") { dismiss() }.buttonStyle(.plain).foregroundColor(.white.opacity(0.7))
            }

            if !library.accountEmail.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label(library.accountEmail, systemImage: "person.crop.circle.fill")
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                    Text(library.subscriptionStatus)
                        .font(.system(size: 12)).foregroundColor(library.subscriptionActive ? .green : Color(hex: 0xA9BBD2))
                    Button("Activar prueba gratuita · $0 MXN") {
                        Task { await library.activateTrial() }
                    }
                    .buttonStyle(BlueButtonStyle())
                    .disabled(library.isAccountBusy)
                    Text("Prueba de 1 minuto, sin tarjeta y sin cobro. Solo para pruebas.")
                        .font(.system(size: 10)).foregroundColor(.secondary)
                    Button("Cerrar sesión") { library.signOutCustomer() }
                        .font(.system(size: 11, weight: .semibold)).foregroundColor(Color(hex: 0xFF9B9B))
                        .buttonStyle(.plain)
                }
                .padding(16).background(Color(hex: 0x14243A)).cornerRadius(13)
            } else {
                Picker("Modo", selection: $isRegister) {
                    Text("Iniciar sesión").tag(false)
                    Text("Crear cuenta").tag(true)
                }
                .pickerStyle(.segmented)

                if isRegister {
                    TextField("Nombre", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                }
                TextField("Correo electrónico", text: $email)
                    .textFieldStyle(.roundedBorder)
                SecureField("Contraseña (mínimo 10 caracteres)", text: $password)
                    .textFieldStyle(.roundedBorder)

                Button(isRegister ? "Crear cuenta" : "Iniciar sesión") {
                    Task {
                        await library.authenticateCustomer(
                            email: email,
                            password: password,
                            displayName: displayName,
                            register: isRegister
                        )
                    }
                }
                .buttonStyle(BlueButtonStyle())
                .disabled(library.isAccountBusy || email.trimmingCharacters(in: .whitespaces).isEmpty || password.count < 10)
            }

            Button {
                let switchAccount = !library.accountEmail.isEmpty
                let address = switchAccount
                    ? "https://locutorcm.github.io/EC-Audio-Hub/account.html?client=1&switch=1"
                    : "https://locutorcm.github.io/EC-Audio-Hub/account.html?client=1"
                if let url = URL(string: address) {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Label(
                    library.accountEmail.isEmpty ? "Más opciones · Google y correo" : "Cambiar cuenta · Google y más opciones",
                    systemImage: "globe"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(BlueButtonStyle())
            Text("Se abrirá la página segura de EC Audio. Al terminar, volverás automáticamente a Client Hub.")
                .font(.system(size: 10)).foregroundColor(.secondary)

            Divider().overlay(Color.white.opacity(0.12))
            VStack(alignment: .leading, spacing: 7) {
                Text("DIRECCIÓN DEL SERVIDOR")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(1.2).foregroundColor(Color(hex: 0x70C9F2))
                TextField("https://tu-servidor-api.com", text: $library.apiBaseURL)
                    .textFieldStyle(.roundedBorder)
                Text("Se configura cuando el servidor EC Audio esté publicado. No introduzcas contraseñas ni tokens aquí.")
                    .font(.system(size: 10)).foregroundColor(.secondary)
            }

            if !library.accountMessage.isEmpty {
                Text(library.accountMessage)
                    .font(.system(size: 11)).foregroundColor(Color(hex: 0xA9DDF7))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if library.isAccountBusy { ProgressView().controlSize(.small) }
        }
        .padding(25)
        .frame(width: 430)
        .background(Color(hex: 0x0B1424))
        .preferredColorScheme(.dark)
    }
}
