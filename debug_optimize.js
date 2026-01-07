// 调试优化指令功能的测试脚本
const https = require('https');

// 测试智谱AI API调用
function testOptimizeAPI(command, apiKey) {
    console.log('测试指令:', command);
    console.log('API Key前4位:', apiKey ? apiKey.substring(0, 4) + '...' : '未设置');
    
    const postData = JSON.stringify({
        model: "glm-4-flash", // 尝试小写版本
        messages: [
            {
                role: "system",
                content: "你是一个专业的指令优化助手。请帮助用户优化他们的指令，使其更加清晰、准确和易于理解。请直接返回优化后的指令，不要添加额外的解释。"
            },
            {
                role: "user",
                content: `请优化以下指令，使其更加清晰和准确：\n\n${command}`
            }
        ],
        temperature: 0.3,
        max_tokens: 1000
    });

    console.log('请求数据:', JSON.stringify(JSON.parse(postData), null, 2));

    const options = {
        hostname: 'open.bigmodel.cn',
        port: 443,
        path: '/api/paas/v4/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('HTTP状态码:', res.statusCode);
                console.log('响应头:', res.headers);
                console.log('原始响应:', data);
                
                try {
                    const response = JSON.parse(data);
                    console.log('解析后的响应:', JSON.stringify(response, null, 2));
                    resolve(response);
                } catch (error) {
                    console.error('JSON解析失败:', error);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('请求错误:', error);
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

// 如果直接运行此脚本，进行测试
if (require.main === module) {
    const testCommand = "创建一个简单的网页";
    const testApiKey = "your-api-key-here"; // 需要替换为实际的API Key
    
    if (testApiKey === "your-api-key-here") {
        console.log("请在脚本中设置实际的API Key进行测试");
        process.exit(1);
    }
    
    testOptimizeAPI(testCommand, testApiKey)
        .then(response => {
            console.log('测试完成');
        })
        .catch(error => {
            console.error('测试失败:', error);
        });
}

module.exports = { testOptimizeAPI };
