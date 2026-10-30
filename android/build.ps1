param(
    [Parameter(Mandatory=$true)][string]$JavaHome,
    [Parameter(Mandatory=$true)][string]$BuildTools,
    [Parameter(Mandatory=$true)][string]$AndroidJar,
    [string]$Output = "$PSScriptRoot/build/Siyai-Mia.apk",
    [ValidateSet('debug','release')][string]$SigningMode = 'debug'
)
$ErrorActionPreference = 'Stop'
function Run([string]$Tool, [string[]]$Arguments) {
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $Tool" }
}
$env:JAVA_HOME = $JavaHome
$env:Path = "$JavaHome/bin;$env:Path"
Push-Location $PSScriptRoot
try {
    New-Item -ItemType Directory -Force build/classes,build/dex,build/tmp | Out-Null
    Run "$BuildTools/aapt.exe" @('package','-f','-M','AndroidManifest.xml','-S','res','-I',$AndroidJar,'-F','build/resources.apk')
    $sources = @(Get-ChildItem src -Recurse -Filter *.java | ForEach-Object { $_.FullName })
    Run "$JavaHome/bin/javac.exe" (@('-encoding','UTF-8','-source','8','-target','8','-classpath',$AndroidJar,'-d','build/classes') + $sources)
    Run "$JavaHome/bin/jar.exe" @("-J-Djava.io.tmpdir=$PSScriptRoot/build/tmp",'cf','build/classes.jar','-C','build/classes','.')
    Run "$JavaHome/bin/java.exe" @('-cp',"$BuildTools/lib/d8.jar",'com.android.tools.r8.D8','--min-api','23','--lib',$AndroidJar,'--output','build/dex','build/classes.jar')
    Copy-Item build/resources.apk build/unsigned.apk -Force
    $unsigned = (Resolve-Path build/unsigned.apk).Path
    Push-Location build/dex
    try { Run "$BuildTools/aapt.exe" @('add',$unsigned,'classes.dex') } finally { Pop-Location }
    Run "$BuildTools/zipalign.exe" @('-f','4','build/unsigned.apk','build/aligned.apk')
    if ($SigningMode -eq 'debug') {
        $keyPath = "$PSScriptRoot/build/debug.p12"
        $env:SIYAI_STORE_PASSWORD = 'android'
        $env:SIYAI_KEY_PASSWORD = 'android'
        $keyAlias = 'androiddebugkey'
        if (-not (Test-Path $keyPath)) {
            Run "$JavaHome/bin/keytool.exe" @('-genkeypair','-keystore',$keyPath,'-storetype','PKCS12','-storepass:env','SIYAI_STORE_PASSWORD','-keypass:env','SIYAI_KEY_PASSWORD','-alias',$keyAlias,'-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Android Debug, O=Android, C=US')
        }
    } else {
        foreach ($name in @('SIYAI_KEYSTORE_PATH','SIYAI_STORE_PASSWORD','SIYAI_KEY_PASSWORD','SIYAI_KEY_ALIAS')) {
            if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing release variable: $name" }
        }
        $keyPath = $env:SIYAI_KEYSTORE_PATH
        $keyAlias = $env:SIYAI_KEY_ALIAS
        if (-not (Test-Path $keyPath)) { throw 'Release keystore not found' }
    }
    New-Item -ItemType Directory -Force (Split-Path $Output) | Out-Null
    Run "$JavaHome/bin/java.exe" @('-jar',"$BuildTools/lib/apksigner.jar",'sign','--ks',$keyPath,'--ks-key-alias',$keyAlias,'--ks-pass','env:SIYAI_STORE_PASSWORD','--key-pass','env:SIYAI_KEY_PASSWORD','--out',$Output,'build/aligned.apk')
    Run "$JavaHome/bin/java.exe" @('-jar',"$BuildTools/lib/apksigner.jar",'verify','--verbose','--print-certs',$Output)
    Run "$BuildTools/aapt.exe" @('dump','badging',$Output)
} finally { Pop-Location }
