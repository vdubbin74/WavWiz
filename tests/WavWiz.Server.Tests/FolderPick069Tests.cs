using WavWiz.PlayerCore;
namespace WavWiz.Server.Tests;

/// <summary>0.6.9 #6: the page <-> Windows app protocol for the native folder dialog.</summary>
public class FolderPick069Tests
{
    [Fact]
    public void Parses_a_pick_request_and_ignores_everything_else()
    {
        var r = FolderPick.Parse("{\"cmd\":\"pickFolder\",\"id\":\"f1a\",\"title\":\"Choose a music folder\",\"initial\":\"D:\\\\Music\"}");
        Assert.NotNull(r); Assert.Equal("f1a", r!.Id); Assert.Equal(@"D:\Music", r.Initial);
        Assert.Null(FolderPick.Parse("{\"cmd\":\"mini\"}"));
        Assert.Null(FolderPick.Parse("{\"cmd\":\"pickFolder\",\"id\":\"../x\"}"));
        Assert.Null(FolderPick.Parse("not json"));
        Assert.Null(FolderPick.Parse("{\"cmd\":\"pickFolder\",\"id\":\"a\",\"initial\":\"C:\\\\x\\nrm\"}")!.Initial);
    }

    [Fact]
    public void Answers_with_the_path_or_null_when_cancelled()
    {
        Assert.Equal("{\"cmd\":\"folderPicked\",\"id\":\"f1\",\"path\":\"D:\\\\Music\"}", FolderPick.Answer("f1", @"D:\Music"));
        Assert.Equal("{\"cmd\":\"folderPicked\",\"id\":\"f1\",\"path\":null}", FolderPick.Answer("f1", null));
    }

    [Fact]
    public void The_window_shows_the_Windows_folder_dialog_and_posts_the_answer()
    {
        var root = AppContext.BaseDirectory; while (!File.Exists(Path.Combine(root, "WavWiz.sln"))) root = Path.GetDirectoryName(root)!;
        var f = File.ReadAllText(Path.Combine(root, "src", "WavWiz.Player", "Forms.cs"));
        Assert.Contains("if (FolderPick.Parse(j) is { } fp) { BeginInvoke(() => PickFolder(cw, fp)); return; }", f);
        Assert.Contains("new FolderBrowserDialog", f);
        Assert.Contains("cw.PostWebMessageAsJson(FolderPick.Answer(r.Id, path))", f);
    }
}
