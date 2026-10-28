# Sebby Windows Job Runner — source prototype, disabled

This folder contains auditable C# P/Invoke source and a pure JavaScript protocol validator. **No binary was built. No Windows behavior was tested. Nothing invokes this helper from Sebby.** Do not enable Windows npm/build/test execution on the basis of these source tests.

The project targets `net10.0-windows` / `win-x64`, using the current supported .NET 10 LTS branch. Build only in a separately approved Windows validation environment with an already installed, supported .NET 10 SDK:

```powershell
dotnet build .\Sebby.JobRunner.csproj -c Release
```

This command is documentation only, not executed in the Linux workspace. Building may contact NuGet/MSBuild dependency sources; no tool or SDK installation is requested or automated. No service, elevation, registry/ACL modification, installer or signing action is implemented.

See [`../../docs/WINDOWS-CONTAINMENT.md`](../../docs/WINDOWS-CONTAINMENT.md) for the protocol, threat boundary, Microsoft references, current evidence and required native validation matrix.
