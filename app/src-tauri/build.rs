fn main() {
    // requireAdministrator: приложение всегда стартует с правами администратора.
    // Без них Windows не даёт поднять TUN-адаптер и правила WFP, а Zapret —
    // свои фильтры. Уровень задан в манифесте, поэтому UAC спрашивается на
    // старте один раз, а не в момент нажатия «Подключение».
    println!("cargo:rerun-if-env-changed=K4R_NO_ADMIN");
    let manifest = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>"#;
    let attrs = tauri_build::Attributes::new();
    // K4R_NO_ADMIN=1 собирает тестовый exe без манифеста: WebView2 150 не отдаёт
    // CDP у elevated-процесса, поэтому живые тесты гоняются на копии без UAC.
    let attrs = if std::env::var_os("K4R_NO_ADMIN").is_some() {
        attrs
    } else {
        attrs.windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(manifest))
    };
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}