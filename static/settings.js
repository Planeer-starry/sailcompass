/* 出海罗盘 · 设置视图（#/settings）：内容由本脚本注入，index.html 只留空容器
   renderSettings() 首次进入时填充，标志位保证只填一次 */

const PROVIDER_PRESETS = [
  {id:"zhipu", name:"智谱 AI", badge:"全部免费",
   base_url:"https://open.bigmodel.cn/api/paas/v4",
   text_model:"glm-4-flash", vision_model:"glm-4v-flash",
   image_model:"cogview-3-flash", free:true,
   note:"文本、识图、生图都有免费额度，注册即用"},
  {id:"deepseek", name:"DeepSeek", badge:"便宜",
   base_url:"https://api.deepseek.com/v1",
   text_model:"deepseek-chat", vision_model:"deepseek-flash",
   image_model:"", free:false,
   note:"国内直连快，文本便宜；不支持生图"},
  {id:"siliconflow", name:"硅基流动", badge:"送额度",
   base_url:"https://api.siliconflow.cn/v1",
   text_model:"Qwen/Qwen2.5-7B-Instruct",
   vision_model:"Qwen/Qwen2.5-VL-7B-Instruct",
   image_model:"", free:true,
   note:"注册送额度；不支持生图"},
  {id:"custom", name:"自定义", badge:"",
   base_url:"", text_model:"", vision_model:"", image_model:"",
   free:false, note:"任何兼容 OpenAI 协议的服务"}
];

var settingsRendered = false;   // 首次进入才填充，避免每次切路由都重写 DOM

function renderSettings() {
  if (settingsRendered) { return; }
  settingsRendered = true;
  document.getElementById("view-settings").innerHTML = `
    <div class="home-wrap">
      <div class="settings-placeholder">
        <p class="settings-icon">⚙️</p>
        <p class="settings-text">模型配置功能即将上线</p>
      </div>
    </div>`;
}