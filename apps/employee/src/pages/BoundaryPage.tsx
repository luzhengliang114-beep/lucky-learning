import type { PageProps } from "../appTypes";
import { PageHeader } from "../components";

const boundarySections = [
  {
    title: "本系统定位",
    content: "本系统为企业、门店内部员工学习测评工具，主要用于岗位知识学习、操作规范查看、内部资料管理、测评考核和学习记录管理。"
  },
  {
    title: "使用范围",
    content: "本系统仅限企业或门店授权员工内部使用，不面向社会公众招生，不提供学历教育、学科辅导、职业资格考试培训或课程售卖服务。"
  },
  {
    title: "内容来源",
    content: "系统内文字、图片、视频、题库等内容由企业或门店管理员自行上传、编辑和维护。上传方应确保内容来源合法、真实、合规，不侵犯第三方知识产权、肖像权、隐私权及其他合法权益。"
  },
  {
    title: "禁止内容",
    content: "用户不得上传违法违规内容、盗版课程、影视作品、涉政有害信息、低俗色情内容、虚假宣传内容、医疗金融夸大宣传内容，或其他违反法律法规及平台规则的内容。"
  },
  {
    title: "内部使用限制",
    content: "员工账号仅限本人使用。系统内资料仅供内部学习和考核，不得未经授权转发、下载、录屏、传播或用于商业售卖。"
  },
  {
    title: "管理责任",
    content: "企业或门店管理员应对其上传内容、员工账号、测评题库和使用行为承担管理责任。本平台有权对违规内容进行删除、下架、限制访问或暂停服务。"
  },
  {
    title: "服务性质",
    content: "本系统提供的是软件工具服务，不直接提供教育培训内容，不组织对外教学活动，不承诺考试、升学、职业资格或就业结果。"
  }
];

export function BoundaryPage({ navigate }: PageProps) {
  return (
    <div className="boundary-page">
      <PageHeader title="工具边界" subtitle="内部员工学习测评工具使用规范" onBack={() => navigate("profile")} />
      <ol className="boundary-list">
        {boundarySections.map((section, index) => (
          <li key={section.title}>
            <span aria-hidden="true">{index + 1}</span>
            <div>
              <h2>{section.title}</h2>
              <p>{section.content}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
