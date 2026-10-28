// Interop structures are populated by native APIs; unassigned reserved fields intentionally remain zero.
#pragma warning disable CS0649
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Sebby.JobRunner;

internal sealed class KernelHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    public KernelHandle() : base(true) { }
    public KernelHandle(IntPtr handle) : base(true) => SetHandle(handle);
    protected override bool ReleaseHandle() => Native.CloseHandle(handle);
}

internal static class Native
{
    internal const uint CREATE_SUSPENDED = 0x00000004;
    internal const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    internal const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    internal const uint CREATE_NO_WINDOW = 0x08000000;
    internal const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    internal const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    internal const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    internal const nuint PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
    internal const nuint PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
    internal const uint WAIT_OBJECT_0 = 0, WAIT_TIMEOUT = 258, WAIT_FAILED = 0xFFFFFFFF;
    internal const uint STARTF_USESTDHANDLES = 0x00000100;

    [StructLayout(LayoutKind.Sequential)] internal struct SECURITY_ATTRIBUTES
    { internal int Length; internal IntPtr SecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] internal bool InheritHandle; }
    [StructLayout(LayoutKind.Sequential)] internal struct STARTUPINFO
    {
        internal int cb;
        internal IntPtr lpReserved, lpDesktop, lpTitle;
        internal uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        internal ushort wShowWindow, cbReserved2;
        internal IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct STARTUPINFOEX
    { internal STARTUPINFO StartupInfo; internal IntPtr AttributeList; }
    [StructLayout(LayoutKind.Sequential)] internal struct PROCESS_INFORMATION
    { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)] internal struct BASIC_LIMITS
    {
        internal long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        internal uint ActiveProcessLimit;
        internal UIntPtr Affinity;
        internal uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct IO_COUNTERS
    { internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] internal struct EXTENDED_LIMITS
    { internal BASIC_LIMITS BasicLimitInformation; internal IO_COUNTERS IoInfo; internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern KernelHandle CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetInformationJobObject(KernelHandle job, int informationClass, ref EXTENDED_LIMITS limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool TerminateJobObject(KernelHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsProcessInJob(KernelHandle process, KernelHandle job, [MarshalAs(UnmanagedType.Bool)] out bool inJob);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreatePipe(out KernelHandle read, out KernelHandle write, ref SECURITY_ATTRIBUTES attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetHandleInformation(KernelHandle handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref nuint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, nuint attribute, IntPtr value, nuint size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(KernelHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(KernelHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetExitCodeProcess(KernelHandle process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool PeekNamedPipe(KernelHandle pipe, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr left);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ReadFile(KernelHandle file, byte[] buffer, uint count, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern uint GetWindowsDirectoryW(StringBuilder buffer, uint size);
}
