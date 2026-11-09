const groups = [
  { title: "登录与个人资料", items: [
    { value: "openid", title: "识别账号", description: "允许应用使用 HFLive 账号登录。" },
    { value: "profile", title: "基本资料", description: "读取显示名、用户名和头像。" },
    { value: "email", title: "邮箱", description: "读取邮箱及其验证状态。" },
    { value: "offline_access", title: "保持应用登录", description: "允许应用在用户离开后续期已授权的会话。" },
  ] },
  { title: "服务端目录权限 · 按需批准", items: [
    { value: "directory:user:read", title: "读取成员资料", description: "服务端可按成员标识读取统一身份资料，包含管理员维护的身份字段。" },
    { value: "directory:user:status", title: "读取账号状态", description: "服务端可检查成员账号是否正常或已停用。" },
  ] },
];

export function ClientScopeFields({ selected = [], disabled = false }: { selected?: string[]; disabled?: boolean }) {
  return <fieldset className="scope-field" disabled={disabled}><legend>应用可访问的信息与能力</legend>
    {groups.map((group) => <div className="scope-group" key={group.title}><h3>{group.title}</h3>{group.items.map((item) => <label key={item.value}><input type="checkbox" name="scopes" value={item.value} defaultChecked={selected.includes(item.value)} /><span><strong>{item.title}</strong><code>{item.value}</code><small>{item.description}</small></span></label>)}</div>)}
  </fieldset>;
}
