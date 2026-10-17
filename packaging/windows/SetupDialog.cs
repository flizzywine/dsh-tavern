using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;

// The folder choice and its explanation stay on screen until explicitly accepted.
class SetupDialog : Form {
 readonly TextBox directory=new TextBox();
 public string InstallRoot { get { return Path.GetFullPath(directory.Text.Trim()); } }
 public SetupDialog(string initial,bool existing) {
  Text=existing?"更新 DSH Tavern":"安装 DSH Tavern";
  ClientSize=new Size(600,300);AutoScaleMode=AutoScaleMode.Dpi;
  StartPosition=FormStartPosition.CenterParent;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;
  var heading=new Label{Text=existing?"已找到原安装，将更新程序并保留数据。":"选择安装文件夹",AutoSize=false};
  heading.SetBounds(24,22,550,28);Controls.Add(heading);
  directory.SetBounds(24,60,444,26);directory.Text=initial;directory.ReadOnly=existing;Controls.Add(directory);
  var browse=new Button{Text="浏览…",Enabled=!existing};browse.SetBounds(480,58,96,30);Controls.Add(browse);
  browse.Click+=delegate{using(var picker=new FolderBrowserDialog{Description="选择用于存放 DSH Tavern 的文件夹",SelectedPath=directory.Text})if(picker.ShowDialog(this)==DialogResult.OK)directory.Text=Path.Combine(picker.SelectedPath,"DSH-Tavern");};
  var note=new Label{Text=existing?"将关闭此安装的酒馆并联网更新，请先保存当前操作。\n原数据位置保持不变，本次不会迁移数据。":"程序、运行环境和新数据将存放在此文件夹。\n首次安装需要联网；官方 Harness 固定为 0.2.1-rc.2。"};
  note.SetBounds(24,105,550,52);Controls.Add(note);
  var entry=new Label{Text="安装后：从桌面或开始菜单打开「DSH Tavern」。\n下载的安装包可以删除，已安装的启动入口会保留。"};
  entry.SetBounds(24,171,550,48);Controls.Add(entry);
  var cancel=new Button{Text="取消",DialogResult=DialogResult.Cancel};cancel.SetBounds(344,246,96,32);Controls.Add(cancel);CancelButton=cancel;
  var install=new Button{Text=existing?"修复并启动":"安装并启动"};install.SetBounds(454,246,122,32);Controls.Add(install);AcceptButton=install;
  install.Click+=delegate{
   try {
    if(string.IsNullOrWhiteSpace(directory.Text)||!Path.IsPathRooted(directory.Text.Trim()))throw new Exception("请输入完整的安装路径，例如 D:\\Apps\\DSH-Tavern。");
    string path=InstallRoot;
    if(path.TrimEnd('\\')==Path.GetPathRoot(path).TrimEnd('\\'))throw new Exception("请选择磁盘下的独立文件夹，不要直接选择盘符根目录。");
    Directory.CreateDirectory(path);
    string probe=Path.Combine(path,".write-check-"+Guid.NewGuid().ToString("N"));using(File.Create(probe)){}File.Delete(probe);
    DialogResult=DialogResult.OK;Close();
   } catch(Exception e){MessageBox.Show(this,"无法使用此安装位置："+e.Message,"DSH Tavern",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
  };
 }
}

// Do not change the remembered installation until the user accepts setup.
class MissingInstallationDialog : Form {
 public string ExistingRoot { get; private set; }
 public MissingInstallationDialog(string previous,Func<string,bool> hasInstallation) {
  Text="找不到原安装位置";ClientSize=new Size(640,310);AutoScaleMode=AutoScaleMode.Dpi;
  StartPosition=FormStartPosition.CenterParent;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;
  var note=new Label{Text="原安装目录已删除、移动，或所在磁盘尚未连接。\n要保留旧聊天和角色卡，请连接原磁盘或选择原安装文件夹。"};
  note.SetBounds(24,20,590,52);Controls.Add(note);
  var directory=new TextBox{Text=previous};directory.SetBounds(24,84,474,28);Controls.Add(directory);
  var browse=new Button{Text="浏览…"};browse.SetBounds(510,82,106,30);Controls.Add(browse);
  browse.Click+=delegate{using(var picker=new FolderBrowserDialog{Description="选择原安装文件夹（包含 launcher-settings.xml 或 runtime 文件夹）"})if(picker.ShowDialog(this)==DialogResult.OK)directory.Text=picker.SelectedPath;};
  var warning=new Label{Text="如果已卸载并希望重新开始，请选择「重新安装」。\n下一步可选择安装位置；不会删除旧文件，也不会恢复已删除的数据。"};
  warning.SetBounds(24,138,590,60);Controls.Add(warning);
  var cancel=new Button{Text="取消",DialogResult=DialogResult.Cancel};cancel.SetBounds(240,242,100,34);Controls.Add(cancel);CancelButton=cancel;
  var fresh=new Button{Text="重新安装"};fresh.SetBounds(350,242,120,34);Controls.Add(fresh);
  fresh.Click+=delegate{ExistingRoot=null;DialogResult=DialogResult.OK;Close();};
  var restore=new Button{Text="使用原目录"};restore.SetBounds(480,242,136,34);Controls.Add(restore);AcceptButton=restore;
  restore.Click+=delegate{
   try {
    string path=directory.Text.Trim();
    if(!Path.IsPathRooted(path)||!hasInstallation(path))throw new Exception("此目录中没有找到原安装，请检查文件夹或连接原磁盘。");
    ExistingRoot=Path.GetFullPath(path);DialogResult=DialogResult.OK;Close();
   }catch(Exception e){MessageBox.Show(this,e.Message,"DSH Tavern",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
  };
 }
}
