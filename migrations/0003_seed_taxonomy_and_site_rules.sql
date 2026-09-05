PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO glossary_domains(id,name,parent_id,kind,created_at) VALUES
('domain-robotics','机器人学',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('domain-ai-ml','人工智能与机器学习',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('domain-cs-se','计算机科学与软件工程',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('domain-math-control','数学与控制',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('domain-aerospace-mechanics','航空航天与力学',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('domain-electronics-comms','电子与通信',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('domain-general-academic','通用学术',NULL,'top_level',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO glossary_subdomains(id,domain_id,name,aliases_json,created_at,updated_at) VALUES
('sub-ros2','domain-robotics','ROS 2','["ROS2"]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-manipulator','domain-robotics','机械臂','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-mobile-robot','domain-robotics','移动机器人','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-slam','domain-robotics','SLAM','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-px4','domain-robotics','无人机/PX4','["PX4","无人机"]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-perception-planning','domain-robotics','感知与规划','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-robot-control','domain-robotics','机器人控制','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-deep-learning','domain-ai-ml','深度学习','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-rl','domain-ai-ml','强化学习','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-cv','domain-ai-ml','计算机视觉','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-nlp','domain-ai-ml','自然语言处理','["NLP"]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-multimodal','domain-ai-ml','多模态','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-llm','domain-ai-ml','大模型','["LLM"]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-linux','domain-cs-se','Linux','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-os','domain-cs-se','操作系统','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-network','domain-cs-se','网络','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-pl','domain-cs-se','编程语言','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-compiler','domain-cs-se','编译','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-database','domain-cs-se','数据库','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-software-engineering','domain-cs-se','软件工程','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-toolchain','domain-cs-se','工具链','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-linear-algebra','domain-math-control','线性代数','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-probability','domain-math-control','概率统计','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-optimization','domain-math-control','优化','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-numerical','domain-math-control','数值方法','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-control','domain-math-control','控制理论','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-signal-processing','domain-math-control','信号处理','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-flight-control','domain-aerospace-mechanics','飞行控制','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-aerodynamics','domain-aerospace-mechanics','空气动力学','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-structural','domain-aerospace-mechanics','结构力学','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-vibration','domain-aerospace-mechanics','振动力学','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-guidance','domain-aerospace-mechanics','导航制导','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-orbital','domain-aerospace-mechanics','轨道力学','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-embedded','domain-electronics-comms','嵌入式系统','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-sensor','domain-electronics-comms','传感器','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-communications','domain-electronics-comms','通信','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-signal','domain-electronics-comms','信号','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('sub-circuits','domain-electronics-comms','电子电路','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO website_rules(id,workspace_id,domain_pattern,path_pattern,default_mode,primary_domain_id,tags_json,dynamic_strategy,translate_new_content,toolbar_position,url_pattern,subdomain_ids_json,translate_navigation,translate_buttons,translate_tables,protect_link_text,auto_translate,page_budget_json,pdf_strategy,is_builtin,version,created_at,updated_at) VALUES
('builtin-github',NULL,'github.com','*','below','domain-cs-se','["工具链"]','observe',1,'top','https://github.com/*','["sub-toolchain"]',0,0,1,1,0,'{}','selection_only',1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('builtin-ros2',NULL,'docs.ros.org','*','bilingual','domain-robotics','["ROS 2"]','observe',1,'top','https://docs.ros.org/*','["sub-ros2"]',0,0,1,1,0,'{}','selection_only',1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('builtin-arxiv',NULL,'arxiv.org','*','bilingual','domain-general-academic','[]','static',0,'top','https://arxiv.org/*','[]',0,0,1,1,0,'{}','reader',1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('builtin-nvidia',NULL,'developer.nvidia.com','*','below','domain-cs-se','[]','observe',1,'top','https://developer.nvidia.com/*','[]',0,0,1,1,0,'{}','selection_only',1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('builtin-pytorch',NULL,'pytorch.org','*','below','domain-ai-ml','["深度学习"]','observe',1,'top','https://pytorch.org/*','["sub-deep-learning"]',0,0,1,1,0,'{}','selection_only',1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('builtin-rtd',NULL,'*.readthedocs.io','*','below','domain-general-academic','[]','observe',1,'top','https://*.readthedocs.io/*','[]',0,0,1,1,0,'{}','selection_only',1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO settings(key,value_json,scope,updated_at) VALUES
('glossary.version','0','global',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO NOTHING;

INSERT INTO schema_metadata(key,value,created_at,updated_at) VALUES
('schema_version','3',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value='3',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');

PRAGMA user_version = 3;
